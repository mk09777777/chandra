const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken');
const controller = require('../controllers/jewelryEstimate.controller');
const upload = require('../middleware/imageUpload');

const fields = upload.fields([
    { name: 'topView', maxCount: 1 },
    { name: 'sideView', maxCount: 1 },
    { name: 'fortyFiveView', maxCount: 1 },
    { name: 'additional', maxCount: 5 },
]);

router.post('/', authenticateToken, fields, controller.estimateAndPrice);

module.exports = router;
