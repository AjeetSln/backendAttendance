const mongoose = require('mongoose');

// Salary Schema
const salarySchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true },
    month: { type: Number, required: true }, // Month (1-12)
    year: { type: Number, required: true },  // Year (e.g., 2024)
    day: { type: Number, required: true },   // Day of the month
    grossSalary: { type: Number, required: true },
    netSalary: { type: Number, required: true },
    baseSalary: { type: Number, required: true },
    overtimePay: { type: Number, required: true },
    undertimeDeduction: { type: Number, required: true },
    totalHoursWorked: { type: Number, required: true },
    totalOvertimeHours: { type: Number, required: true },
    totalUndertimeHours: { type: Number, required: true },
    totalPf: { type: Number, required: true }, // Provident Fund contributions
    totalEsic: { type: Number, required: true }, // ESIC contributions
  },
  { timestamps: true } // Automatically adds createdAt and updatedAt
);

module.exports = mongoose.model('Salary', salarySchema);
