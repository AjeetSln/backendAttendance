const mongoose = require('mongoose');

const ShiftAssignmentSchema = new mongoose.Schema({
  employeeId: { type: String, required: true },
  shiftId: { type: String, required: true },
  shiftStart: { type: String, required: true },
  shiftEnd: { type: String, required: true },
  shiftName:{type:String,required:true},
  fromDate: { type: Date, required: true },
  toDate: { type: Date, required: true },
  assignedDate: { type: Date, default: Date.now },
  description: { type: String },
});
ShiftAssignmentSchema.index({ toDate: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ShiftAssignment', ShiftAssignmentSchema);