const mongoose = require('mongoose');

const StoneSchema = new mongoose.Schema({
  Type: String,
  Color: String,
  Shape: String,
  MmSize: String,
  SieveSize: String,
  Weight: Number,
  Pcs: Number,
  CtWeight: Number,
  Price: Number,
  Markup: Number,
}, { _id: false });

module.exports = StoneSchema;
