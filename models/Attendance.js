  const mongoose = require('mongoose');
  const ShiftAssignment = require('../models/ShiftAssignment')

  const attendanceSchema = new mongoose.Schema({
    employeeId: { type: String, required: true },
    name : {type:String,required : true},
    date: { type: String, required: true },
    shiftId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShiftAssignment', required: true },
    shiftName: { type: String },
    checkInTime: { type: Date },
    checkOutTime: { type: Date },
    location: String,
    status: {
      type: String,
      enum: ['Checked-In', 'P', 'A', 'Weekoff', 'U'],
      required: true,
    },
    hoursWorked: {type:String},
    overtimeHours: {type:String},
    underTimeHours: {type:String},
  });
  attendanceSchema.index({ employeeId: 1, date: 1, shiftId: 1 }, { unique: true });
  module.exports = mongoose.model('Attendance', attendanceSchema);
