const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  employeeId: { type: String, required: true },
  name : {type:String,required : true},
  date: { type: String, required: true },
  shiftId: { type: String},
  shiftName: { type: String },
  checkInTime: { type: Date },
  checkOutTime: { type: Date },
  location: String,
  status: {
    type: String,
    enum: ['Checked-In', 'P', 'A', 'Weekoff', 'U'],
    required: true,
  },
  hoursWorked: Number,
  overtimeHours: Number,
  underTimeHours: Number,
});

module.exports = mongoose.model('Attendance', attendanceSchema);
