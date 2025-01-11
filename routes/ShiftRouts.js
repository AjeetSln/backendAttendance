const express = require('express');
const router = express.Router();
const Shift = require('../models/Shift');
const ShiftAssignment = require('../models/ShiftAssignment');
const User = require('../models/User');
const cron = require('node-cron');
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
    const { employeeId, shiftId, shiftName,shiftStart,shiftEnd, fromDate, toDate } = req.body;

    // Validate the required fields
    if (!employeeId || !shiftId || !shiftName || !fromDate || !toDate) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Fetch the user and shift using await
    const user = await User.findOne({ employeeId });
    const shift = await Shift.findOne({ _id: shiftId });

    if (!user) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    if (!shift) {
      return res.status(404).json({ message: 'Shift not found' });
    }

    const from = new Date(fromDate);
    const to = new Date(toDate);

    // Ensure "toDate" is after "fromDate"
    if (to < from) {
      return res.status(400).json({ message: 'To date must be after From date' });
    }

    // Check for overlapping shifts of the same shiftId or shiftName
    const overlappingAssignment = await ShiftAssignment.findOne({
      employeeId,
      $and: [
        {
          $or: [
            { shiftId: shiftId }, // Same shift ID
            { shiftName: shiftName }, // Same shift name
          ],
        },
        {
          $or: [
            { fromDate: { $lte: to }, toDate: { $gte: from } }, // Overlapping date range
          ],
        },
      ],
    });

    // If there's an overlap, return an error
    if (overlappingAssignment) {
      return res
        .status(400)
        .json({ message: 'Shift overlaps with an existing assignment of the same type' });
    }

    // Update the user's shiftTime
    user.shiftTime = {
      shiftName: shift.shiftName,
      shiftStart: shift.shiftStart,
      shiftEnd: shift.shiftEnd,
    };
    await user.save();

    // Create and save the shift assignment
    const assignment = new ShiftAssignment({
      employeeId,
      shiftId,
      shiftName,
      shiftStart,
      shiftEnd,
      fromDate: from,
      toDate: to,
    });

    await assignment.save();
    res.status(201).json({ message: 'Shift assigned successfully', assignment });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
cron.schedule('* * * * *', async () => {
  try {
    const now = new Date();
    const result = await ShiftAssignment.deleteMany({ toDate: { $lt: now } });
    console.log(`${result.deletedCount} expired shifts deleted`);
  } catch (error) {
    console.error('Error deleting expired shifts:', error);
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

    // Find all shift assignments for the employee
    const shiftAssignments = await ShiftAssignment.find({ employeeId });

    // If no shifts are found, return 404
    if (!shiftAssignments.length) {
      return res.status(404).json({ message: 'No shifts found for this employee' });
    }

    // Map the shift assignments into a more user-friendly structure
    const shifts = shiftAssignments.map((assignment) => ({
      shiftName: assignment.shiftName,
      shiftId:assignment.shiftId,
      shiftStart: assignment.shiftStart,
      shiftEnd: assignment.shiftEnd,
      assignedDate: assignment.assignedDate,
      description: assignment.description || 'No description provided', // Default description if none is provided
    }));

    // Respond with the formatted shift data
    res.json(shifts);
  } catch (error) {
    console.error('Error retrieving employee shifts:', error);
    res.status(500).json({ message: 'Error retrieving employee shifts', error: error.message });
  }
});



module.exports = router;