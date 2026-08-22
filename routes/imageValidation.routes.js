const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken');
const controller = require('../controllers/imageValidation.controller');
const upload = require('../middleware/imageUpload');

router.post('/', authenticateToken, upload.single('image'), controller.validateImage);

module.exports = router;
