const mongoose = require('mongoose');
const StoneSchema = require('./common/stone.schema');
const MetalSchema = require('./common/metal.schema');

const designEmbeddingSchema = new mongoose.Schema({
    Name:        { type: String },
    UploadedBy:  { type: String },
    DesignType:  { type: String, enum: ['coral', 'cad'], required: true },
    EnquiryId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry' },
    Version:     { type: String },
    Key:         { type: String, required: true },
    Category:    { type: String },
    Group:       { type: String },
    Description: { type: String },
    Tags:        [{ type: String }],
    Metal:       [MetalSchema],
    Stones:      [StoneSchema],
    Embedding:   { type: [Number], required: true },
    TextEmbedding: { type: [Number] },
    CreatedAt:   { type: Date, default: Date.now },
    isOnlyMetalDesign: { type: Boolean, default: false },
});

designEmbeddingSchema.index({ EnquiryId: 1 });
designEmbeddingSchema.index({ DesignType: 1 });

module.exports = mongoose.model('DesignEmbedding', designEmbeddingSchema);
