const mongoose = require('mongoose');
const StoneSchema = require('./common/stone.schema');
const MetalSchema = require('./common/metal.schema');

  const ChecklistSchema = new mongoose.Schema({
    Engraving: { type: String, default: 'NA' },
    SizeLength: { type: String, default: 'NA' },
    SizeRingSize: { type: String, default: 'NA' },
    DimensionsThickness: { type: String, default: 'NA' },
    DeliveryDate: { type: String, default: 'NA' },
    EnamelPaintwork: { type: String, default: 'NA' },
    RhodiumInstructions: { type: String, default: 'NA' },
    Components: { type: String, default: 'NA' },
    Findings: { type: String, default: 'NA' },
    GeneratedAt: Date,
  }, { _id: false });

  const PricingSchema = new mongoose.Schema({
    MetalPrice: { type: Number, default: 0 },
    DiamondsPrice: { type: Number, default: 0 },
    TotalPrice: { type: Number, default: 0 },
    DutiesAmount: { type: Number, default: 0 },
    NaturalDuties: { type: Number, default: 0 },
    LabDuties: { type: Number, default: 0 },
    GoldDuties: { type: Number, default: 0 },
    SilverAndLabsDuties: { type: Number, default: 0 },
    LossAndLabourDuties: { type: Number, default: 0 },
    Loss: { type: Number, default: 0 },
    Labour: { type: Number, default: 0 },
    ExtraCharges: {
        Type: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
        Value: { type: Number, default: 0 }
    },
    DiamondWeight: Number,
    TotalPieces: Number,
    ClientPricingMessage: { type: String, default: null },
    UndercutPrice: { type: Number, default: 0 },
    Stones: {
      type: [StoneSchema]
    },
    Metal: MetalSchema,
  }, { _id: false });

const enquirySchema = new mongoose.Schema({
    Name: String,
    Quantity: Number,
    StyleNumber: String,
    GatiOrderNumber: String,
    ClientId: { type: String, ref: 'Client' },
    StatusHistory: [{
        Status: String,
        SubStatus: { type: String, default: null },
        Timestamp: Date,
        AssignedTo: String,
        Details: String,
        AddedBy: String
    }],
    Priority: String,
    Metal: {
        Color: String,
        Quality: String
    },
    Category: String,
    StoneType: String,
    MetalWeight: {
        From: Number,
        To: Number,
        Exact: Number
    },
    DiamondWeight: {
        From: Number,
        To: Number,
        Exact: Number
    },
    Stamping: String,
    Remarks: String,
    SpecialRemarks: String,
    Checklist: { type: ChecklistSchema, default: null },
    Summary: { type: String, default: null },
    // Internal bookkeeping for the SLA escalation job (not surfaced in search).
    Escalation: {
        type: new mongoose.Schema({
            StatusAnchor: Date,                       // lastStatus.Timestamp this window is tracking
            Bumps: { type: Number, default: 0 },      // auto priority bumps applied this window
            LastHandlerAlertOn: String,               // YYYY-MM-DD of last handler escalation
            LastAdminAlertOn: String,                 // YYYY-MM-DD of last admin escalation
        }, { _id: false }),
        default: null,
    },
    Budget: String,
    ShippingDate: Date,
    ApprovedDate: Date,
    ReferenceImages: [{
        Id: String,
        Key: String,
        Description: String,
        MimeType: String
    }],
    SimilarDesigns: [{
        EnquiryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry' },
        Key: String,
        Score: Number
    }],
    Coral: [{
        Version: String,
        CoralCode: String,
        Cost: Number,
        IsOnlyMetalDesign: Boolean,
        Images: [{
            Id: String,
            Key: String,
            Description: String
        }],
        Excel: {
            Id: String,
            Key: String,
            Description: String
        },
        Pricing: {
            type: [PricingSchema]
        },
        IsApprovedVersion: Boolean,
        ReasonForRejection: String,
        CreatedDate: { type: Date, default: Date.now }
    }],
    Cad: [{
        Version: String,
        CadCode: String,
        Cost: Number,
        IsOnlyMetalDesign: Boolean,
        Images: [{
            Id: String,
            Key: String,
            Description: String
        }],
        Excel: {
            Id: String,
            Key: String,
            Description: String
        },
        Pricing: {
            type: [PricingSchema]
        },
        IsFinalVersion: Boolean,
        IsApprovedVersion: Boolean,
        ReasonForRejection: String,
        CreatedDate: { type: Date, default: Date.now }
    }]
});

enquirySchema.index({ "Cad.CadCode": 1 });
enquirySchema.index({ "Coral.CoralCode": 1 });

// Also index your other top-level search fields
enquirySchema.index({ Name: 1 });
enquirySchema.index({ StyleNumber: 1 });
enquirySchema.index({ GatiOrderNumber: 1 });

module.exports = mongoose.model('Enquiry', enquirySchema);
