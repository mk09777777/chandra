const DesignEmbedding = require('../models/designEmbedding.model');

exports.create = async (data) => {
  const doc = await DesignEmbedding.create(data);
  return doc.toObject();
};

exports.findById = async (id) => {
  return await DesignEmbedding.findById(id).lean();
};


exports.aggregate = async (pipeline) => {
  return await DesignEmbedding.aggregate(pipeline);
};

exports.deleteOne = async (filter) => {
  return await DesignEmbedding.deleteOne(filter);
};
