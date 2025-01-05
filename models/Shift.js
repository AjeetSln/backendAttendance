const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema({
  shiftName: { type: String, required: true },
  shiftStart: { type: String, required: true },
  shiftEnd: { type: String, required: true },
  description: { type: String },
});

module.exports = mongoose.model('Shift', shiftSchema);
