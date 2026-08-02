const { uploadToS3, generatePresignedUrl } = require('../utils/s3');
const { describeAndEmbedImage } = require('./imageDescribe.service');
const { generateEmbedding, generateTextEmbedding } = require('../utils/embedding');
const { extractPricingDataFromImage } = require('./imagePricing.service');
const { findSimilar, findSimilarByText } = require('./designSimilarity.service');
const designRepo = require('../repositories/design.repo');

exports.insertDesign = async ({ designType, images, name, uploadedBy, mimeType, stones, metal, s3Key, enquiryId, indexEmbedding = true, isOnlyMetalDesign = false, version = null }) => {
    designType = designType?.toLowerCase();
    if (!s3Key) {
        const fileObj = { buffer: images, mimetype: mimeType, originalname: name || 'design' };
        s3Key = await uploadToS3(fileObj);
    }

    const pricingData = (stones || metal)
        ? { Metal: metal, Stones: stones || [] }
        : await extractPricingDataFromImage(images, mimeType);

    const descriptionResult = await describeAndEmbedImage({ s3Key, mimetype: mimeType });

    const doc = await designRepo.create({
        Name: name,
        UploadedBy: uploadedBy,
        DesignType: designType,
        EnquiryId: enquiryId || null,
        Key: s3Key,
        Description: descriptionResult?.description || '',
        Tags: descriptionResult?.tags || [],
        Category: descriptionResult?.category || '',
        Group: descriptionResult?.group || '',
        Metal: pricingData?.Metal ? (Array.isArray(pricingData.Metal) ? pricingData.Metal : [pricingData.Metal]) : [],
        Stones: pricingData?.Stones || [],
        Embedding: indexEmbedding ? (descriptionResult?.embedding || []) : [],
        TextEmbedding: indexEmbedding ? (descriptionResult?.textEmbedding || []) : [],
        isOnlyMetalDesign: isOnlyMetalDesign || false,
        Version: version || null,
    });

    return { design: doc, descriptionResult };
};

exports.getDesignById = async (id) => {
    const design = await designRepo.findById(id);
    if (!design) throw Object.assign(new Error('Design not found'), { status: 404 });

    if (design.Key) {
        design.Url = await generatePresignedUrl(design.Key);
    }

    return design;
};

exports.lookup = async ({ buffer, mimeType, search, designType, category, skip, limit }) => {
    designType = designType?.toLowerCase();
    if (buffer) {
        const embedding = await generateEmbedding(buffer, mimeType);
        try {
            return await vectorSearchDesigns({ embedding, embeddingType: 'image', designType, category, skip, limit });
        } catch (err) {
            console.warn('[lookup] vector search failed, falling back to filter:', err.message);
            return await filterDesigns({ designType, category, skip, limit });
        }
    }

    if (search) {
        let textEmbedding;
        try {
            textEmbedding = await generateTextEmbedding(search);
        } catch {
            return await filterDesigns({ search, designType, category, skip, limit });
        }
        let vectorResults;
        try {
            vectorResults = await vectorSearchDesigns({ embedding: textEmbedding, embeddingType: 'text', designType, category, skip, limit });
        } catch (err) {
            console.warn('[lookup] text vector search failed, falling back to regex:', err.message);
            return await filterDesigns({ search, designType, category, skip, limit });
        }
        if (vectorResults.images.length >= limit) return vectorResults;

        const regexResults = await filterDesigns({ search, designType, category, skip: 0, limit });
        const seenIds = new Set(vectorResults.images.map(i => String(i.enquiryId)));
        const fill = regexResults.images.filter(i => !seenIds.has(String(i.enquiryId)));
        vectorResults.images.push(...fill.slice(0, limit - vectorResults.images.length));
        vectorResults.total = vectorResults.images.length;
        return vectorResults;
    }

    if (designType || category) {
        return await filterDesigns({ search, designType, category, skip, limit });
    }

    return await filterDesigns({ skip, limit });
};

async function resolvePresignedUrls(item) {
    const url = item.Key ? await generatePresignedUrl(item.Key) : null;
    const variantImages = await Promise.all((item.images || []).map(async (img) => ({
        ...img,
        url: img.key ? await generatePresignedUrl(img.key) : null,
    })));
    return { url, variantImages };
}

async function vectorSearchDesigns({ embedding, embeddingType = 'image', designType, category, skip = 0, limit = 10 }) {
    const filter = {};
    if (designType) filter.DesignType = designType.toLowerCase();
    if (category) filter.Category = category;

    const searchFn = embeddingType === 'text' ? findSimilarByText : findSimilar;
    const searchParam = embeddingType === 'text' ? 'textEmbedding' : 'embedding';

    const results = await searchFn({
        [searchParam]: embedding,
        limit: skip + limit,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        skipEnquiryLookup: true,
    });

    const pagedResults = results.slice(skip, skip + limit);

    const images = await Promise.all(pagedResults.map(async (r) => {
        const { url, variantImages } = await resolvePresignedUrls(r);
        return {
            Url: url,
            Name: r.Name || '',
            enquiryId: r.enquiryId,
            designId: r.docId,
            score: r.score,
            versions: (r.versions || []).filter(Boolean),
            images: variantImages,
        };
    }));

    return { images, total: images.length, skip, limit };
}

async function filterDesigns({ search, designType, category, skip = 0, limit = 10 }) {
    const match = {};
    if (search) match.$or = [
        { Description: { $regex: search, $options: 'i' } },
        { Tags: { $regex: search, $options: 'i' } },
    ];

    if (designType) match.DesignType = designType;
    if (category) match.Category = category;

    const groupStage = {
        $group: {
            _id: '$EnquiryId',
            docId: { $first: '$_id' },
            Name: { $first: '$Name' },
            Key: { $first: '$Key' },
            Category: { $first: '$Category' },
            Description: { $first: '$Description' },
            versions: { $addToSet: '$Version' },
            images: { $push: { designId: '$_id', key: '$Key', version: '$Version' } },
        },
    };

    const [facetResult] = await designRepo.aggregate([
        { $match: match },
        {
            $facet: {
                results: [
                    { $sort: { CreatedAt: -1 } },
                    groupStage,
                    { $skip: skip },
                    { $limit: limit },
                ],
                totalCount: [
                    { $group: { _id: '$EnquiryId' } },
                    { $count: 'total' },
                ],
            },
        },
    ]);

    const results = facetResult.results || [];
    const total = facetResult.totalCount[0]?.total || 0;

    const images = await Promise.all(results.map(async (d) => {
        const { url, variantImages } = await resolvePresignedUrls(d);
        return {
            enquiryId: d._id,
            Name: d.Name || '',
            Category: d.Category || '',
            Description: d.Description || '',
            designId: d.docId,
            Url: url,
            versions: (d.versions || []).filter(Boolean),
            images: variantImages,
        };
    }));

    return { images, total, skip, limit };
}
