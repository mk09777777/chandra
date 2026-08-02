const designRepo = require('../repositories/design.repo');

const VECTOR_INDEX = 'design_embedding_index';
const TEXT_VECTOR_INDEX = 'design_text_embedding_index';

const EMBEDDING_CONFIG = {
    image: { index: VECTOR_INDEX, path: 'Embedding', scoreThreshold: 0.9 },
    text: { index: TEXT_VECTOR_INDEX, path: 'TextEmbedding', scoreThreshold: 0.85 },
};

exports.indexDesign = async ({ enquiryId, type, version, key, category, description, tags, embedding }) => {
    return await designRepo.create({
        EnquiryId: enquiryId,
        DesignType: type,
        Version: version || null,
        Key: key,
        Category: category,
        Description: description,
        Tags: tags || [],
        Embedding: embedding,
    });
};

async function _findSimilar({ embedding, embeddingType = 'image', limit = 5, excludeEnquiryId, filter: extraFilter, skipEnquiryLookup = false }) {
    const config = EMBEDDING_CONFIG[embeddingType];
    const filter = extraFilter || (
        embeddingType === 'text'
            ? { DesignType: { $in: ['coral', 'cad'] }, TextEmbedding: { $exists: true, $ne: [] } }
            : { DesignType: { $in: ['coral', 'cad'] } }
    );
    if (excludeEnquiryId) filter.EnquiryId = { $ne: excludeEnquiryId };

    const matchPipeline = [
        {
            $vectorSearch: {
                index: config.index,
                path: config.path,
                queryVector: embedding,
                numCandidates: 1000,
                limit: 50,
                filter,
            },
        },
        { $addFields: { score: { $meta: 'vectorSearchScore' } } },
        { $match: { score: { $gte: config.scoreThreshold } } },
        ...(skipEnquiryLookup
            ? []
            : [
                { $lookup: { from: 'enquiries', localField: 'EnquiryId', foreignField: '_id', as: 'enquiry' } },
                { $match: { 'enquiry.0': { $exists: true } } },
              ]),
        { $group: { _id: '$EnquiryId', score: { $max: '$score' } } },
        { $sort: { score: -1 } },
        { $limit: limit },
    ];

    const matches = await designRepo.aggregate(matchPipeline);
    if (!matches.length) return [];

    const enquiryIds = matches.map(m => m._id);
    const scoreMap = {};
    matches.forEach(m => { scoreMap[String(m._id)] = m.score; });

    const results = await designRepo.aggregate([
        { $match: { EnquiryId: { $in: enquiryIds } } },
        { $sort: { CreatedAt: -1 } },
        {
            $group: {
                _id: '$EnquiryId',
                docId: { $first: '$_id' },
                Name: { $first: '$Name' },
                Key: { $first: '$Key' },
                versions: { $addToSet: '$Version' },
                images: { $push: { designId: '$_id', key: '$Key', version: '$Version' } },
            },
        },
        {
            $project: {
                _id: 0,
                enquiryId: '$_id',
                docId: 1,
                Name: 1,
                Key: 1,
                versions: 1,
                images: 1,
            },
        },
    ]);

    results.forEach(r => { r.score = scoreMap[String(r.enquiryId)] || 0; });
    results.sort((a, b) => b.score - a.score);
    return results;
}

exports.findSimilar = ({ embedding, limit = 5, excludeEnquiryId, filter, skipEnquiryLookup = false }) =>
    _findSimilar({ embedding, embeddingType: 'image', limit, excludeEnquiryId, filter, skipEnquiryLookup });

exports.findSimilarByText = ({ textEmbedding, limit = 5, excludeEnquiryId, filter, skipEnquiryLookup = false }) =>
    _findSimilar({ embedding: textEmbedding, embeddingType: 'text', limit, excludeEnquiryId, filter, skipEnquiryLookup });
