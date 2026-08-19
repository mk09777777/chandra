const express = require('express');
const router = express.Router();
const controller = require('../controllers/enquiry.controller');
const parseController = require('../controllers/enquiryParse.controller');
const approvalParseController = require('../controllers/approvalParse.controller');
const authenticateToken = require('../middleware/authenticateToken');
const dynamicUpload = require('../middleware/dynamicUpload');
const enquiryCreateUpload = require('../middleware/enquiryCreateUpload');

// GET all enquiries
// router.get('/', authenticateToken, controller.getEnquiries);

// AI parse — must be before /:id routes
router.post('/parse', authenticateToken, parseController.parseEnquiry);
router.post('/parse/approval_parse', approvalParseController.parseApproval);

router.get('/export-pdf',
    authenticateToken,
    controller.exportEnquiriesPdf);

// Search
router.get('/search', authenticateToken, controller.searchEnquiries);

// Aggregated Counts
router.get('/aggregate', authenticateToken, controller.getAggregatedCounts);

// GET enquiry by id
router.get('/:id', authenticateToken, controller.getEnquiryById);

// GET enquiries by clientId
// router.get('/client/:clientId', authenticateToken, controller.getEnquiriesByClientId);

// POST a new enquiry (multipart: JSON body in `data` field, files in `referenceImages`)
router.post('/', authenticateToken, enquiryCreateUpload, controller.createEnquiry);

// PUT update an enquiry by ID
router.put('/:id', authenticateToken, controller.updateEnquiry);

// DELETE an enquiry by ID
router.delete('/:id', authenticateToken, controller.deleteEnquiry);

// Upload assets (coral, cad, reference)
router.post(
    '/:id/upload/:type',
    authenticateToken,  // First middleware: Authentication
    dynamicUpload,      // Second middleware: File upload handling
    controller.uploadAssets // Third middleware: Processing the uploaded files
);

// Mass Actions
router.post(
    '/mass-action',
    authenticateToken,  // First middleware: Authentication
    controller.massActionEnquiries
);


//Update asset details, marking as approved, 
router.put('/:id/upload/:type',
    authenticateToken,
    controller.updateAssets
)

router.post('/pricingCalculate',
    authenticateToken,
    controller.getPricing
)

router.get('/files/:key', authenticateToken, controller.getPresignedFileUrl);

module.exports = router;
