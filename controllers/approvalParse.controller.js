const service = require('../services/approvalMessage_parse.service');

exports.parseApproval = async (req, res) => {
    try {
        console.log('approval_parsing → received body:', JSON.stringify(req.body));
        const result = await service.parseApprovalMessage(req.body);
        console.log('approval_parsing → sending response:', JSON.stringify(result));
        res.json(result);
    } catch (err) {
        console.error('Error parsing approval message:', err);
        const status = err.message === 'message is required' ? 400 : 500;
        res.status(status).json({ message: err.message || 'Failed to parse approval message' });
    }
};
