const express = require('express');
const router = express.Router();
const { protect, admin } = require('../Middleware/authMiddleware');
const User = require('../models/User');

// Update employee weekoff schedule
router.put('/update-weekoff/:employeeId', protect, admin, async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { weekoffDays } = req.body;

        // Validate weekoffDays (must be an array of valid weekdays)
        const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        if (!Array.isArray(weekoffDays) || !weekoffDays.every(day => validDays.includes(day))) {
            return res.status(400).json({ message: 'Invalid weekoff days' });
        }

        // Find the employee
        const employee = await User.findOne({ employeeId });
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        // Update the weekoff schedule
        employee.weekoffSchedule = weekoffDays;

        // Save the updated data
        await employee.save();

        res.status(200).json({
            message: 'Weekoff schedule updated successfully',
            weekoffSchedule: employee.weekoffSchedule,
        });
    } catch (error) {
        res.status(500).json({ message: 'Error updating weekoff schedule', error });
    }
});

// Get weekoff schedule for a specific employee
router.get('/weekoff-schedule/:employeeId', protect, async (req, res) => {
    try {
        const { employeeId } = req.params;

        const employee = await User.findOne({ employeeId });
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        res.status(200).json({
            weekoffSchedule: employee.weekoffSchedule,
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching weekoff schedule', error });
    }
});


module.exports = router;
