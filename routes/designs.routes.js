const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken');
const controller = require('../controllers/designs.controller');
const upload = require('../middleware/imageUpload');

router.post('/insert', authenticateToken, (req, res, next) => {
    upload.single('image')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message || 'File upload error' });
        next();
    });
}, controller.insertDesign);

router.get('/:id', authenticateToken, controller.getById);

router.post('/lookup', authenticateToken, (req, res, next) => {
    upload.single('image')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message || 'File upload error' });
        next();
    });
}, controller.lookup);

module.exports = router;
