const mongoose = require('mongoose');

const AssignedOffice = new mongoose.Schema({
  employeeId: { type: String, required: true },
  officeId: { type: String, required: true },
  officeName :{type:String,required:true},
});

module.exports = mongoose.model('AssignedOffice',AssignedOffice);