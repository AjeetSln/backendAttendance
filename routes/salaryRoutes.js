const express = require('express');
const router = express.Router();
const cron = require('node-cron');
const User = require('../models/User'); // Assuming the user model is in this path
const Attendance = require('../models/Attendance'); // Assuming the attendance model is in this path
const Salary = require('../models/Salary'); // Assuming salary model
//const calculateAndSaveSalary = require('./utils/calculateAndSaveSalary'); // Utility function

// Cron job to run daily at midnight
cron.schedule('0 0 * * *', async () => {
  console.log('Cron job triggered at midnight.');

  const currentDate = new Date();
  const day = currentDate.getDate();
  const month = currentDate.getMonth() + 1; // Month is 0-based in JavaScript
  const year = currentDate.getFullYear();

  try {
    console.log('Fetching all employees...');
    const employees = await User.find({});
    console.log(`Total employees found: ${employees.length}`);

    await Promise.all(
      employees.map(async (employee) => {
        console.log(`Processing salary for employeeId: ${employee.employeeId}`);
        await calculateAndSaveSalary(employee.employeeId, month, year, day);
      })
    );

    console.log('Salary calculation completed for all employees.');
  } catch (error) {
    console.error('Error during salary calculation cron job:', error);
  }
});

// Function to calculate and save the salary
const calculateAndSaveSalary = async (employeeId, month, year, day) => {
  try {
    const user = await User.findOne({ employeeId });

    if (!user) {
      console.error(`User not found for employeeId: ${employeeId}`);
      return;
    }

    console.log(`Fetched user details for employeeId: ${employeeId}`);

    const monthlySalary = user.salary;
    const shiftStart = user.shiftTime.start;
    const shiftEnd = user.shiftTime.end;

    console.log(`Shift timings: ${shiftStart} - ${shiftEnd}`);

    // Parse shift timings into hours
    const [startHour, startMinute] = shiftStart.split(':').map(Number);
    const [endHour, endMinute] = shiftEnd.split(':').map(Number);
    const workingHours = (endHour + endMinute / 60) - (startHour + startMinute / 60);

    console.log(`Working hours per shift: ${workingHours}`);

    const attendanceRecord = await Attendance.findOne({
      employeeId,
      status: { $in: ['P', 'U', 'Weekoff'] },
      date: {
        $gte: new Date(year, month - 1, day),
        $lt: new Date(year, month - 1, day + 1),
      },
    });

    let totalHoursWorked = attendanceRecord?.hoursWorked || 0;
    let totalOvertimeHours = attendanceRecord?.overtimeHours || 0;
    let totalUndertimeHours = attendanceRecord?.underTimeHours || 0;

    console.log(
      `Attendance data - Hours Worked: ${totalHoursWorked}, Overtime: ${totalOvertimeHours}, Undertime: ${totalUndertimeHours}`
    );

    const dailySalary = calculateDailySalary(monthlySalary, user.totalWorkingDays);
    const hourlySalary = calculateHourlySalary(dailySalary, workingHours);

    console.log(`Daily Salary: ${dailySalary}, Hourly Salary: ${hourlySalary}`);

    const baseSalary = dailySalary;
    const overtimePay = hourlySalary * totalOvertimeHours;
    const undertimeDeduction = hourlySalary * totalUndertimeHours;
    const grossSalary = baseSalary + overtimePay - undertimeDeduction;

    console.log(`Gross Salary: ${grossSalary}`);

    const employerPf = grossSalary * 0.125; // 12.5%
    const employeePf = grossSalary * 0.12;  // 12%
    const employerEsic = grossSalary * 0.0325; // 3.25%
    const employeeEsic = grossSalary * 0.0075; // 0.75%

    const totalDeductions = employeePf + employeeEsic;
    const netSalary = grossSalary - totalDeductions;

    console.log(`Net Salary: ${netSalary}`);

    const salary = new Salary({
      employeeId,
      month,
      year,
      day,
      grossSalary,
      netSalary,
      baseSalary,
      overtimePay,
      undertimeDeduction,
      totalHoursWorked,
      totalOvertimeHours,
      totalUndertimeHours,
      totalPf: employeePf + employerPf,
      totalEsic: employeeEsic + employerEsic,
    });

    await salary.save();
    console.log(`Salary saved for employeeId: ${employeeId}, Date: ${day}-${month}-${year}`);
  } catch (error) {
    console.error(`Error calculating salary for employeeId ${employeeId}:`, error);
  }
};

// Helper function to calculate daily salary
const calculateDailySalary = (monthlySalary, totalWorkingDays) => {
  if (!totalWorkingDays || totalWorkingDays <= 0) {
    console.error('Invalid working days for salary calculation.');
    return 0;
  }
  return monthlySalary / totalWorkingDays;
};

// Helper function to calculate hourly salary
const calculateHourlySalary = (dailySalary, workingHours) => {
  if (!workingHours || workingHours <= 0) {
    console.error('Invalid working hours for salary calculation.');
    return 0;
  }
  return dailySalary / workingHours;
};
router.get('/salary/employees', async (req, res) => {
  const { endDate } = req.query;

  if (!endDate) {
    return res.status(400).json({ error: 'End date is required' });
  }

  try {
    const parsedEndDate = new Date(endDate);
    if (isNaN(parsedEndDate)) {
      return res.status(400).json({ error: 'Invalid end date format' });
    }

    const employees = await User.find({});
    const employeesWithEndDate = employees.map((employee) => {
      const creationDate = new Date(employee.createdAt);

      // Calculate monthly cycle end date
      let currentCycleEndDate = new Date(
        parsedEndDate.getFullYear(),
        parsedEndDate.getMonth(),
        creationDate.getDate()
      );

      // Adjust if end date's day is before creation date's day
      if (parsedEndDate.getDate() < creationDate.getDate()) {
        currentCycleEndDate = new Date(
          parsedEndDate.getFullYear(),
          parsedEndDate.getMonth() - 1,
          creationDate.getDate()
        );
      }

      return {
        employeeId: employee.employeeId,
        name: employee.name,
        profilePic: employee.profilePic || '',
        endDate: currentCycleEndDate.toISOString().split('T')[0], // Cycle end date
        createdAt: employee.createdAt,
        salary: parseFloat(employee.salary), // Ensure salary is a number
      };
    });

    return res.status(200).json(employeesWithEndDate);
  } catch (error) {
    console.error('Error fetching employees:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/employees', async (req, res) => {
  const { endDate } = req.query;

  if (!endDate) {
    return res.status(400).json({ error: 'End date is required' });
  }

  try {
    // Parse the provided end date
    const parsedEndDate = new Date(endDate);
    if (isNaN(parsedEndDate)) {
      return res.status(400).json({ error: 'Invalid end date format' });
    }

    // Fetch all employees from the database
    const employees = await User.find({});
    const employeesWithEndDate = [];

    // Loop through employees to calculate their salary end date
    for (const employee of employees) {
      const creationDate = new Date(employee.createdAt); // Employee's joining date
      const endDateForEmployee = new Date(
        parsedEndDate.getFullYear(),
        parsedEndDate.getMonth(),
        creationDate.getDate() // Use the day of the month from the creation date
      );

      // Adjust if the calculated date exceeds the last day of the selected month
      if (endDateForEmployee.getMonth() !== parsedEndDate.getMonth()) {
        endDateForEmployee.setDate(0); // Set to the last valid date of the month
      }

      // Compare the calculated end date with the selected end date
      if (
        endDateForEmployee.getFullYear() === parsedEndDate.getFullYear() &&
        endDateForEmployee.getMonth() === parsedEndDate.getMonth() &&
        endDateForEmployee.getDate() === parsedEndDate.getDate()
      ) {
        employeesWithEndDate.push({
          employeeId: employee.employeeId,
          name: employee.name,
          profilePic: employee.profilePic || '',
          endDate: endDateForEmployee.toISOString().split('T')[0], // Format date
          createdAt: employee.createdAt,
          salary:employee.salary,
          shiftTime:employee.shiftTime,
        });
      }
    }

    if (employeesWithEndDate.length > 0) {
      return res.status(200).json(employeesWithEndDate);
    } else {
      return res.status(404).json({ error: 'No employees found with salary ending on this date' });
    }
  } catch (error) {
    console.error('Error fetching employees:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET route to fetch salary details for an employee
router.get('/salary/:employeeId/:month/:year', async (req, res) => {
  const { employeeId, month, year } = req.params;

  try {
    const salary = await Salary.findOne({ employeeId, month, year });

    if (!salary) {
      return res.status(404).json({
        error: `Salary details not found for Employee ID: ${employeeId}, Month: ${month}, Year: ${year}`,
      });
    }

    res.status(200).json({
      grossSalary: salary.grossSalary,
      netSalary: salary.netSalary,
      totalPf: salary.totalPf,
      totalEsic: salary.totalEsic,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
