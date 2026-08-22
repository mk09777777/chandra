const service = require('../services/enquiry.service');

exports.getEnquiries = async (req, res) => {
    try {
        const enquiries = await service.getEnquiries();
        res.json(enquiries);
    } catch (error) {
        console.error("Error fetching enquiries:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

exports.getEnquiryById = async (req, res) => {
    try {
        const enquiries = await service.getEnquiry(req.params.id);
        res.json(enquiries);
    } catch (error) {
        console.error("Error fetching enquiries:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

exports.getEnquiriesByClientId = async (req, res) => {
    try {
        const clientId = req.params.clientId;
        const enquiries = await service.getEnquiriesByClientId(clientId);
        res.json(enquiries);
    } catch (error) {
        console.error("Error fetching enquiries by clientId:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

exports.getEnquiriesByUserId = async (req, res) => {
    try {
        const userId = req.user._id;
        const enquiries = await service.getEnquiriesByUserId(userId);
        res.json(enquiries);
    } catch (error) {
        console.error("Error fetching enquiries by userId:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

exports.createEnquiry = async (req, res) => {
    const userId = req.user._id;
    try {
        // Multipart: JSON body in `data` field; fall back to req.body for plain JSON callers.
        let data = req.body;
        if (typeof req.body?.data === 'string') {
            try {
                data = JSON.parse(req.body.data);
            } catch {
                return res.status(400).json({ message: "Invalid JSON in 'data' field" });
            }
        }
        let referenceImageDescriptions = [];
        if (typeof req.body?.referenceImageDescriptions === 'string') {
            try {
                referenceImageDescriptions = JSON.parse(req.body.referenceImageDescriptions);
            } catch {
                return res.status(400).json({ message: "Invalid JSON in 'referenceImageDescriptions' field" });
            }
        }

        const files = req.files?.referenceImages || [];
        const enquiry = await service.createEnquiry(data, files, userId, referenceImageDescriptions);
        res.status(201).json(enquiry);
    } catch (error) {
        console.error("Error creating enquiry:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

exports.updateEnquiry = async (req, res) => {
    const userId = req.user._id;
    try {
        const enquiry = await service.updateEnquiry(req.params.id, req.body, userId);
        res.json(enquiry);
    } catch (error) {
        console.error("Error updating enquiry:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

exports.deleteEnquiry = async (req, res) => {
    try {
        await service.deleteEnquiry(req.params.id);
        res.status(204).send();
    } catch (error) {
        console.error("Error deleting enquiry:", error);
        if (error.message === 'Enquiry not found') {
            return res.status(404).json({ message: "Enquiry not found" });
        }
        res.status(500).json({ message: "Internal server error" });
    }
};

exports.uploadAssets = async (req, res) => {
    const { id, type } = req.params;
    const files = req.files;
    const version = req.body.version;
    const userId = req.user._id;
    const code = req.body.code; // CadCode or CoralCode
    const cost = req.body.cost; // Optional numeric cost for this Coral / Cad version
    const isFinalVersion = req.body.isFinalVersion === true; // Flag for Final CAD upload
    const isOnlyMetalDesign = req.body.isOnlyMetalDesign === true;

    try {
      const result = await service.handleAssetUpload(id, type, files, version, code, userId, cost, isFinalVersion, isOnlyMetalDesign);
      res.status(200).json({ message: 'Upload successful', data: result });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Upload failed', error: err.message });
    }
};

exports.updateAssets = async (req, res) => {
    const { id, type } = req.params;
    const version = req.query.version;
    const data = req.body;
    const userId = req.user._id;

    if (!version && type !== 'reference') {
        return res.status(400).json({ message: 'Version is required' });
    }

    try {
        const result = await service.updateAssetData(id, type, version, data, userId);
        res.status(200).json({ message: 'Media updated successfully', data: result });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Update failed', error: err.message });
    }
};
  

exports.getPresignedFileUrl = async (req, res) => {
    try {
      const { key } = req.params;
      const action = req.query.download === 'true' ? 'download' : 'view';
      const url = await service.getPresignedUrl(key, action);
      res.json({ url });
    } catch (err) {
      if (err && err.code === 'INVALID_S3_KEY') {
        return res.status(400).json({ error: 'Invalid S3 key' });
      }
      console.error('Error generating presigned URL:', err);
      res.status(500).json({ error: 'Failed to generate URL' });
    }
};

exports.getPricing = async (req, res) => {
    try {
        const { details: detailsJson, clientId, isRecalculate = false, isOnlyMetalDesign = false } = req.body;
        if (!detailsJson) {
            return res.status(400).json({ message: "Details parameter is required" });
        }
        const pricing = await service.calculatePricing(detailsJson, clientId, isOnlyMetalDesign, isRecalculate);
        res.json(pricing);
    } catch (error) {
        console.error("Error calculating pricing:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

exports.getAggregatedCounts = async (req, res) => {
    try {
        // Pass the entire query object (e.g., { groupBy: 'status', assignedTo: 'xyz' })
        const results = await service.getAggregatedCounts(req.query, req.user._id);
        res.json(results);

    } catch (error) {
        console.error("Error aggregating enquiries:", error);
        
        // Handle specific errors from the service
        if (error.message.startsWith("Missing 'groupBy'") || error.message.startsWith("Invalid aggregation type")) {
             return res.status(400).json({ message: error.message });
        }
        
        res.status(500).json({ message: "Internal server error" });
    }
};

exports.searchEnquiries = async (req, res) => {
    try {
        // Pass all UI query params (e.g., ?search=...&status=...&page=1)
        const results = await service.searchEnquiries(req.query, req.user._id);
        res.json(results);
    } catch (error) {
        console.error("Error searching enquiries:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

exports.massActionEnquiries = async (req, res) => {
    try {
        const { enquiryIds, updateType, newStatus } = req.body;
        const userId = req.user?._id || 'System';

        const result = await service.massActionEnquiries({
            enquiryIds,
            updateType,
            newStatus,
            userId
        });

        res.json({
            success: true,
            message: "Mass action completed",
            result
        });

    } catch (error) {
        console.error("Error in mass action:", error);
        res.status(500).json({
            message: "Internal server error",
            error: error.message
        });
    }
};

exports.exportEnquiriesPdf = async (req, res) => {
    try {
        // Reuse same filters/sort from UI (req.query or req.body — your choice)
        const pdfBuffer = await service.exportEnquiriesPdf(req.query, req.user._id);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
            "Content-Disposition",
            'attachment; filename="enquiries-report.pdf"'
        );

        res.send(pdfBuffer);
    } catch (error) {
        console.error("Error exporting enquiries PDF:", error);
        res.status(500).json({
            message: "Failed to generate PDF report",
            error: error.message
        });
    }
};

