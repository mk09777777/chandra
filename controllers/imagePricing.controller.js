const service = require('../services/imagePricing.service');

exports.extractAndPrice = async (req, res) => {
    console.log('[crop][controller] /image-pricing HIT', {
        hasFile: !!req.file,
        fileBytes: req.file?.size,
        bodyKeys: Object.keys(req.body || {}),
        cropRaw: { cropX: req.body?.cropX, cropY: req.body?.cropY, cropW: req.body?.cropW, cropH: req.body?.cropH },
    });
    const { clientId, stoneType, quantity, metalQuality, cropX, cropY, cropW, cropH } = req.body;

    if (!req.file) {
        return res.status(400).json({ error: 'image is required' });
    }
    if (!clientId) {
        return res.status(400).json({ error: 'clientId is required' });
    }
    if(!stoneType) {
        return res.status(400).json({ error: 'stoneType is required' });
    }

    // Crop fractions (0..1) are optional. Only honoured when ALL four are real finite numbers,
    // otherwise the whole image is processed (a stray/partial value must not become a 0 crop).
    const cropNums = [cropX, cropY, cropW, cropH].map(Number);
    const crop = cropNums.every(v => Number.isFinite(v))
        ? { x: cropNums[0], y: cropNums[1], w: cropNums[2], h: cropNums[3] }
        : null;
    console.log('[crop][controller] received', { raw: { cropX, cropY, cropW, cropH }, resolved: crop, fileBytes: req.file?.size });

    try {
        const result = await service.extractAndPrice({
            imageBuffer: req.file.buffer,
            mimeType: req.file.mimetype,
            clientId,
            stoneType: stoneType || null,
            quantity: quantity ? parseInt(quantity, 10) : 1,
            metalQuality: metalQuality || null,
            crop,
        });
        res.json(result);
    } catch (err) {
        const status = err.status || 500;
        console.error('[imagePricing] error:', err.message);
        res.status(status).json({ error: err.message || 'Image pricing failed' });
    }
};
