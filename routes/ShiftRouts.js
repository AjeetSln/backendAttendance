const express = require('express');
const router = express.Router();
const Shift = require('../models/Shift');
const ShiftAssignment = require('../models/ShiftAssignment');
const User = require('../models/User');

// Route to add a shift
router.post('/register-Shift', async (req, res) => {
  try {
    const { shiftName, shiftStart, shiftEnd, description } = req.body;

    // Create a new shift entry
    const newShift = new Shift({
      shiftName,
      shiftStart,
      shiftEnd,
      description,
    });

    // Save the shift to the database
    await newShift.save();
    res.status(201).json({ message: 'Shift created successfully', shift: newShift });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create shift', error: error.message });
  }
});
// Route to get all shifts
router.get('/all-shifts', async (req, res) => {
  try {
    const shifts = await Shift.find();
    res.json(shifts);
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving shifts' });
  }
});
router.post('/assign-shift', async (req, res) => {
  try {
    const { employeeId, shiftId, fromDate, toDate, shiftName, description } = req.body;
    const user = await User.findOne({ employeeId });
    if (!user) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    const shift = await Shift.findOne({ _id: shiftId });
    if (!shift) {
      return res.status(404).json({ message: 'Shift not found' });
    }

    // Validate input
    if (!employeeId || !shiftId || !fromDate || !toDate || !shiftName) {
      return res.status(400).json({ message: 'Employee ID, Shift ID, shiftName, fromDate, and toDate are required' });
    }

    const from = new Date(fromDate);
    const to = new Date(toDate);

    // Ensure valid date range
    if (to < from) {
      return res.status(400).json({ message: '"toDate" must be greater than or equal to "fromDate"' });
    }

    // Check for overlap
    const overlappingAssignment = await ShiftAssignment.findOne({
      employeeId,
      shiftId,
      $or: [{ fromDate: { $lte: to }, toDate: { $gte: from } }],
    });

    if (overlappingAssignment) {
      return res.status(400).json({ message: 'Shift assignment overlaps with an existing shift for this employee' });
    }
    user.shiftTime = {
      start: shift.shiftStart, // set start time from shift
      end: shift.shiftEnd, // set end time from shift
    };
    await user.save();
    // Save shift assignment
    const assignment = new ShiftAssignment({
      employeeId,
      shiftId,
      shiftName, // Include shiftName in the stored data
      fromDate: from,
      toDate: to,
      description,
    });

    await assignment.save();

    res.status(201).json({ message: 'Shift assigned successfully', assignment });
  } catch (error) {
    res.status(500).json({ message: 'Failed to assign shift', error: error.message });
  }
});
// GET route to fetch all shift assignments
router.get('/shift-assignments', async (req, res) => {
  try {
    const assignments = await ShiftAssignment.find().populate('employeeId', 'name').populate('shiftId', 'shiftName');
    
    res.status(200).json(assignments);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch shift assignments', error: error.message });
  }
});
router.get('/employee-shift/:employeeId', async (req, res) => {
  try {
    const employeeId = req.params.employeeId;
    const shiftAssignments = await ShiftAssignment.find({ employeeId }).populate('shiftId');

    if (!shiftAssignments.length) {
      return res.status(404).json({ message: 'No shifts found for this employee' });
    }

    const shifts = shiftAssignments.map((assignment) => ({
      shiftName: assignment.shiftId.shiftName,
      shiftStart: assignment.fromDate,
      shiftEnd: assignment.toDate,
    }));

    res.json(shifts);
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving employee shifts', error: error.message });
  }
});


module.exports = router;