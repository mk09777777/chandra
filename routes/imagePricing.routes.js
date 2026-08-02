const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken');
const controller = require('../controllers/imagePricing.controller');
const upload = require('../middleware/imageUpload');

router.post('/', authenticateToken, upload.single('image'), controller.extractAndPrice);

module.exports = router;
