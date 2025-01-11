const mongoose = require('mongoose');

// OfficeLocation Schema
const officeLocationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  latitude: {
    type: Number,
    required: true,
  },
  longitude: {
    type: Number,
    required: true,
  },
  radius: {
    type: Number,
    required: true,
  },
});

// Create the model from the schema
const OfficeLocation = mongoose.model('OfficeLocation', officeLocationSchema);

module.exports = OfficeLocation;
