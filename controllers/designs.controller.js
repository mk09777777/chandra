const service = require('../services/designs.service');

exports.insertDesign = async (req, res) => {
    const { designType, name } = req.body;
    const uploadedBy = req.user?._id;

    if (!req.file) {
        return res.status(400).json({ error: 'image is required' });
    }
    if (!designType) {
        return res.status(400).json({ error: 'designType is required' });
    }

    try {
        const result = await service.insertDesign({
            designType,
            images: req.file.buffer,
            mimeType: req.file.mimetype,
            name,
            uploadedBy,
        });
        res.json(result);
    } catch (err) {
        console.error('[designs] error:', err.message);
        res.status(err.status || 500).json({ error: err.message || 'Insert design failed' });
    }
};

exports.getById = async (req, res) => {
    try {
        const result = await service.getDesignById(req.params.id);
        res.json(result);
    } catch (err) {
        console.error('[designs] error:', err.message);
        res.status(err.status || 500).json({ error: err.message || 'Design not found' });
    }
};

exports.lookup = async (req, res) => {
    try {
        const result = await service.lookup({
            buffer: req.file?.buffer,
            mimeType: req.file?.mimetype,
            search: req.body.search,
            designType: req.body.designType,
            category: req.body.category,
            skip: parseInt(req.query.skip, 10) || 0,
            limit: parseInt(req.query.limit, 10) || 10,
        });
        res.json(result);
    } catch (err) {
        console.error('[designs] error:', err.message);
        res.status(err.status || 500).json({ error: err.message || 'Lookup failed' });
    }
};
