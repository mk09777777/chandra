const mongoose = require('mongoose');

const DiamondSchema = new mongoose.Schema({
    Type: { type: String },
    Shape: { type: String },
    Carat: {type: Number},
    MmSize: { type: String },
    SieveSize: { type: String},
    Price: { type: Number }
  }, { _id: false });
  
  const PricingSchema = new mongoose.Schema({
    Loss: { type: Number },
    Labour: { type: Number },
    ExtraCharges: {
        Type: { type: String, enum: ['percentage', 'fixed'] },
        Value: { type: Number }
    },
    NaturalDuties: { type: Number },
    LabDuties: { type: Number },
    GoldDuties: { type: Number },
    SilverAndLabsDuties: { type: Number },
    LossAndLabourDuties: { type: Number },
    UndercutPrice: { type: Number },
    Diamonds: [DiamondSchema]
  }, { _id: false });
  
  const ClientSchema = new mongoose.Schema({
    Name: { type: String, required: true },
    ImageUrl: { type: String },
    PriorityOrder: { type: Number },
    Pricing: PricingSchema,
    PricingMessageFormat: { type: String },
    ApplicableStoneTypes: { type: [String], default: [] }
  });
  
  module.exports = mongoose.model('Client', ClientSchema);
