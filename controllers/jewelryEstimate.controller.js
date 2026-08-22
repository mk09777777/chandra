const service = require('../services/jewelryEstimate.service');

exports.estimateAndPrice = async (req, res) => {
    const { clientId, description } = req.body;

    if (!req.files?.topView?.[0]) {
        return res.status(400).json({ error: 'topView image is required' });
    }
    if (!clientId) {
        return res.status(400).json({ error: 'clientId is required' });
    }

    try {
        const result = await service.estimateAndPrice({
            files: req.files,
            clientId,
            description: description || null,
        });
        res.json(result);
    } catch (err) {
        const status = err.status || 500;
        console.error('[jewelryEstimate] error:', err.message);
        res.status(status).json({ error: err.message || 'Jewelry estimate failed' });
    }
};
