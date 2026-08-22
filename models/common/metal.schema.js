const mongoose = require('mongoose');

const MetalSchema = new mongoose.Schema({
  Weight: Number,
  Color: String,
  Quality: String,
  Rate: Number,
}, { _id: false });

module.exports = MetalSchema;
