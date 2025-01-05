const mongoose = require('mongoose');

const counterSchema = mongoose.Schema({
  _id: { type: String, required: true },
  count: { type: Number, default: 1 }, // Start counting from 1
});

const Counter = mongoose.model('Counter', counterSchema);

module.exports = Counter;
