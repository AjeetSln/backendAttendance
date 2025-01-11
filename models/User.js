const mongoose = require('mongoose');

const userSchema = mongoose.Schema(
  {
    employeeId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // Plain text password
    role: { type: String, required: true, enum: ['admin', 'employee'], default: 'employee' },
    mobile: { type: String },
    category: { type: String },
    staffType: { type: String, required: true, enum: ['regular', 'field'], default: 'regular' },
    salary: { type: Number, required: true },
    address: { type: String, required: true },
    aadhar: { type: String, required: true, unique: true },
    profilePic: { type: String, required: true },
    weekoffSchedule: { type: [String], default: [] }, // List of weekoff days
    
    officeLocation: {
    officename: { type: String,  },
    latitude: {
      type: Number,
      
    },
    longitude: {
      type: Number,
      
    },
    radius: {
      type: Number,
    }, },
  },
  { timestamps: true }
);

// Method to compare passwords (direct comparison for both roles)
userSchema.methods.matchPassword = async function (enteredPassword) {
  return enteredPassword === this.password; // Plain text comparison for all roles
};

const User = mongoose.model('User', userSchema);
module.exports = User;
