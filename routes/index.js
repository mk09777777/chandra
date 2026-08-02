const express = require('express');
const router = express.Router();

const enquiryRoutes = require('./enquiry.routes');
const clientRoutes = require('./client.routes');
const userRoutes = require('./user.routes');
const loginRoutes =  require('./login.routes');
const metalPricesRoutes = require('./metalPrices.routes');
const chatRoutes = require('./chat.routes');
const codelistsRoutes = require('./codelists.routes');
const messageRoutes = require('./message.routes');
const notificationsRoutes = require('./notifications.routes');
const imageValidationRoutes = require('./imageValidation.routes');
const imagePricingRoutes = require('./imagePricing.routes');
const jewelryEstimateRoutes = require('./jewelryEstimate.routes');
const designsRoutes = require('./designs.routes');

router.use('/enquiries', enquiryRoutes);
router.use('/clients', clientRoutes);
router.use('/users', userRoutes);
router.use('/login', loginRoutes);
router.use('/metal-prices', metalPricesRoutes);
router.use('/chats', chatRoutes);
router.use('/message', messageRoutes);
router.use('/codelists', codelistsRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/validate-image', imageValidationRoutes);
router.use('/image-pricing', imagePricingRoutes);
router.use('/jewelry-estimate', jewelryEstimateRoutes);
router.use('/designs', designsRoutes);

module.exports = router;
