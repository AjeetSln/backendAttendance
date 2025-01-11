const express = require('express');
const Attendance = require('../models/Attendance');
const axios = require('axios');
const faceapi = require('face-api.js');
const path = require('path')
const canvas = require('canvas');
const User = require('../models/User');
const ShiftAssignment = require('../models/ShiftAssignment')
const OfficeLocation = require('../models/officeLoc');
const AssignedOffice = require('../models/AssignedOffice')
const { protect, admin } = require('../Middleware/authMiddleware');
const cron = require('node-cron');
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const router = express.Router();

let modelsLoaded = false;
let cachedProfileDescriptor = null;

async function loadModels() {
  if (!modelsLoaded) {
    const modelsPath = path.resolve(__dirname, 'models');
    console.log('Models path:', modelsPath);

    await faceapi.nets.tinyFaceDetector.loadFromDisk(modelsPath);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsPath);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);

    modelsLoaded = true;
    console.log('Face API models loaded successfully');
  }
}

function base64ToBuffer(base64String) {
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(base64Data, 'base64');
}

async function bufferToCanvas(buffer) {
  try {
    const image = await canvas.loadImage(buffer);
    const canvasElement = canvas.createCanvas(128, 128); // Smaller resolution for faster processing
    const ctx = canvasElement.getContext('2d');
    ctx.drawImage(image, 0, 0, 128, 128); // Scale image down
    return canvasElement;
  } catch (error) {
    console.error('Error converting buffer to canvas:', error);
    throw error;
  }
}

async function getProfileDescriptor(profilePicUrl) {
  if (!cachedProfileDescriptor) {
    const profilePicResponse = await axios.get(profilePicUrl, { responseType: 'arraybuffer', timeout: 5000 });
    const profilePicCanvas = await bufferToCanvas(profilePicResponse.data);

    const profilePicResults = await faceapi
      .detectSingleFace(profilePicCanvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 128, scoreThreshold: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!profilePicResults) throw new Error('Face not detected in profile picture');

    cachedProfileDescriptor = profilePicResults.descriptor;
  }
  return cachedProfileDescriptor;
}

async function compareFaces(profilePicUrl, capturedImageUrl) {
  try {
    const [capturedImageResponse] = await Promise.all([
      axios.get(capturedImageUrl, { responseType: 'arraybuffer', timeout: 5000 })
    ]);

    const capturedImageCanvas = await bufferToCanvas(capturedImageResponse.data);

    const capturedImageResults = await faceapi
      .detectSingleFace(capturedImageCanvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 128, scoreThreshold: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!capturedImageResults) throw new Error('Face not detected in captured image');

    const profileDescriptor = await getProfileDescriptor(profilePicUrl);
    const distance = faceapi.euclideanDistance(profileDescriptor, capturedImageResults.descriptor);
    console.log('Face comparison distance:', distance);

    const threshold = 0.6; // Lower threshold improves match speed
    return distance < threshold;
  } catch (error) {
    console.error('Error comparing faces:', error);
    return false;
  }
}



function calculateDistance(lat1, lon1, lat2, lon2) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const R = 6371e3; // Earth's radius in meters

  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}
const formatTime = (milliseconds) => {
  const hours = Math.floor(milliseconds / (1000 * 60 * 60));
  const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((milliseconds % (1000 * 60)) / 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};


// GET: Fetch office location
router.post('/officeLocations', async (req, res) => {
  const { name, latitude, longitude, radius } = req.body; // Destructure 'name'

  if (!name || !latitude || !longitude || !radius) {
    return res.status(400).json({ error: 'Name, latitude, longitude, and radius are required' });
  }

  try {
    // Create a new office location with the name
    const officeLocation = new OfficeLocation({ name, latitude, longitude, radius });
    await officeLocation.save();

    res.status(201).json({
      message: 'Office location added successfully',
      officeLocation,
    });
  } catch (error) {
    console.error('Error adding office location:', error);
    res.status(500).json({ error: 'Failed to add office location' });
  }
});

router.post('/assign-office', async (req, res) => {
  const { employeeId, officeId, officeName } = req.body;

  if (!employeeId || !officeId || !officeName) {
    return res.status(400).json({ message: 'Employee ID, office ID, and officeName are required' });
  }

  console.log(`Assigning office: ${officeName} to employee: ${employeeId} for office ID: ${officeId}`);

  try {
    // Check if employee exists
    const employee = await User.findOne({ employeeId });
    if (!employee) {
      console.error(`Employee with ID ${employeeId} not found`);
      return res.status(404).json({ message: `Employee with ID ${employeeId} not found` });
    }

    // Check if office exists
    const office = await OfficeLocation.findById(officeId);
    if (!office) {
      console.error(`Office with ID ${officeId} not found`);
      return res.status(404).json({ message: `Office with ID ${officeId} not found` });
    }

    // Assign office to employee
    employee.officeLocation = {
      officename: office.name,
      latitude: office.latitude,
      longitude: office.longitude,
      radius: office.radius,
    };// Simplified assignment for now
    await employee.save();
    console.log(`Office assigned to employee: ${employeeId}`);

    // Create an entry in AssignedOffice collection
    const assignment = new AssignedOffice({
      employeeId,
      officeId,
      officeName,
    });
    await assignment.save();
    console.log(`Assignment created for employee: ${employeeId}`);

    res.status(201).json({ message: 'Office assigned successfully', assignment });
  } catch (error) {
    console.error('Error assigning office:', error);
    res.status(500).json({ message: 'Failed to assign office', error: error.message });
  }
});

// Get all office locations
router.get('/officeLocations', async (req, res) => {
  try {
    const officeLocations = await OfficeLocation.find();
    res.status(200).json(officeLocations);
  } catch (error) {
    console.error('Error fetching office locations:', error);
    res.status(500).json({ error: 'Failed to fetch office locations' });
  }
});

router.post('/markAttendance', async (req, res) => {
  let { employeeId, location, timestamp, type, shiftName,shiftId } = req.body;

  console.log('Request Body:', req.body);

  // Validate location data
  if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
    return res.status(400).json({ error: 'Invalid or missing location data' });
  }

  try {
    // Fetch the user (employee) details
    const user = await User.findOne({ employeeId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Fetch all shifts for the employee based on employeeId
    const shifts = await ShiftAssignment.find({ employeeId });

    if (!shifts.length) {
      return res.status(404).json({ error: 'No shifts assigned to this employee.' });
    }

    const now = new Date(timestamp);

    // Validate the shift based on shiftName and time
    const validShift = shifts.find((shift) => {
      const shiftStartTime = new Date(`${now.toDateString()} ${shift.shiftStart}`);
      const shiftEndTime = new Date(`${now.toDateString()} ${shift.shiftEnd}`);
      return shift.shiftName === shiftName && now >= shiftStartTime && now <= shiftEndTime;
    });

    if (!validShift) {
      return res.status(404).json({ error: 'No valid shift found for the provided shift name and current time.' });
    }

    const currentDate = now.toDateString();
    const shiftStartTime = new Date(`${currentDate} ${validShift.shiftStart}`);
    const shiftEndTime = new Date(`${currentDate} ${validShift.shiftEnd}`);

    if (type === 'Check-In') {
      // Check if Check-In already exists for this shift
      let attendance = await Attendance.findOne({ employeeId, date: currentDate, shiftId });
      if (attendance && attendance.checkInTime) {
        return res.status(400).json({ error: 'Check-In already marked for this shift.' });
      }

      // Fetch location address
      const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${location.latitude}&lon=${location.longitude}`;
      let address = 'Unknown Location';

      try {
        const response = await axios.get(nominatimUrl);
        address = response.data.display_name || 'Unknown Location';
      } catch (error) {
        console.error('Error fetching address:', error.message);
      }

      // Create attendance record
      attendance = new Attendance({
        employeeId,
        name: user.name,
        date: currentDate,
        shiftName: validShift.shiftName,
        shiftId,
        location: address,
        checkInTime: now,
        status: 'Checked-In',
      });

      await attendance.save();
      return res.json({ message: 'Check-In successful.', attendance });
    } else if (type === 'Check-Out') {
      // Fetch attendance record
      let attendance = await Attendance.findOne({ employeeId, date: currentDate, shiftId });
      if (!attendance || !attendance.checkInTime) {
        return res.status(400).json({ error: 'Check-In not found for this shift.' });
      }

      const checkInTime = new Date(attendance.checkInTime);
      const totalMillisecondsWorked = now - checkInTime; // Calculate total worked time in milliseconds
      const formattedHoursWorked = formatTime(totalMillisecondsWorked); 
      const shiftMilliseconds = shiftEndTime - shiftStartTime;
      const overtime = totalMillisecondsWorked > shiftMilliseconds ? totalMillisecondsWorked - shiftMilliseconds : 0;
      const underTime = totalMillisecondsWorked < shiftMilliseconds ? shiftMilliseconds - totalMillisecondsWorked : 0;

      // Update attendance
      attendance.checkOutTime = now;
      attendance.hoursWorked = formattedHoursWorked;
      attendance.overtimeHours = formatTime(overtime * 1000 * 60 * 60); // Convert overtime to hh:mm:ss format
      attendance.underTimeHours = formatTime(underTime * 1000 * 60 * 60);
      attendance.status = formattedHoursWorked >= shiftMilliseconds ? 'P' : 'U';

      await attendance.save();
      return res.json({ message: 'Check-Out successful.', attendance });
    }

    return res.status(400).json({ error: 'Invalid attendance type.' });
  } catch (error) {
    console.error('Error marking attendance:', error);
    res.status(500).json({ error: 'Error marking attendance' });
  }
});

// Auto-checkout logic using a scheduler
const autoCheckoutForShifts = async () => {
  try {
    const currentDate = new Date().toDateString(); // Get today's date
    const shifts = await ShiftAssignment.find({}); // Fetch all shift assignments

    for (const shift of shifts) {
      const shiftEndTime = new Date(`${currentDate} ${shift.shiftEnd}`); // Parse shift end time
      const shiftStartTime = new Date(`${currentDate} ${shift.shiftStart}`); // Parse shift start time

      // Check if the current time is past the shift end time
      if (new Date() >= shiftEndTime) {
        const attendance = await Attendance.findOne({
          employeeId: shift.employeeId,
          date: currentDate,
          shiftName: shift.shiftName,
        });

        // Proceed only if attendance exists and Check-Out has not been marked
        if (attendance && !attendance.checkOutTime) {
          const checkInTime = new Date(attendance.checkInTime); // Get Check-In time
          const totalMillisecondsWorked = shiftEndTime - checkInTime; // Calculate worked time in milliseconds
          const shiftMilliseconds = shiftEndTime - shiftStartTime; // Calculate shift duration in milliseconds

          // Calculate overtime and undertime in numeric hours
          const overtime = totalMillisecondsWorked > shiftMilliseconds
            ? (totalMillisecondsWorked - shiftMilliseconds) / (1000 * 60 * 60) // Convert to hours
            : 0;
          const underTime = totalMillisecondsWorked < shiftMilliseconds
            ? (shiftMilliseconds - totalMillisecondsWorked) / (1000 * 60 * 60) // Convert to hours
            : 0;

          // Format values into hh:mm:ss for saving
          attendance.hoursWorked = formatTime(totalMillisecondsWorked); // Worked hours in hh:mm:ss
          attendance.overtimeHours = formatTime(overtime * 60 * 60 * 1000); // Overtime in hh:mm:ss
          attendance.underTimeHours = formatTime(underTime * 60 * 60 * 1000); // Undertime in hh:mm:ss
          attendance.checkOutTime = shiftEndTime; // Mark the shift end time as Check-Out time
          attendance.status = totalMillisecondsWorked >= shiftMilliseconds ? 'P' : 'U'; // Mark status

          await attendance.save(); // Save updated attendance
          console.log(`Auto-checkout marked successfully for employeeId: ${shift.employeeId}`);
        }
      }
    }
  } catch (error) {
    console.error('Error in auto-checkout logic:', error);
  }
};

// Schedule auto-checkout job to run every minute
cron.schedule('* * * * *', autoCheckoutForShifts);
router.post('/getCurrentShiftStatus', async (req, res) => {
  const { employeeId, timestamp } = req.body;

  try {
    const now = new Date(timestamp || Date.now()); // Current time
    const currentDate = now.toDateString();

    // Fetch all assigned shifts for the employee
    const shifts = await ShiftAssignment.find({ employeeId });

    if (!shifts.length) {
      return res.status(404).json({ error: 'No shifts assigned to this employee.' });
    }

    // Find the current shift based on time
    const currentShift = shifts.find((shift) => {
      const shiftStartTime = new Date(`${currentDate} ${shift.shiftStart}`);
      const shiftEndTime = new Date(`${currentDate} ${shift.shiftEnd}`);
      return now >= shiftStartTime && now <= shiftEndTime;
    });

    // Check if a valid shift is ongoing
    if (currentShift) {
      // Check attendance status for the shift
      const attendance = await Attendance.findOne({
        employeeId,
        date: currentDate,
        shiftId: currentShift.shiftId,
      });

      const status = attendance?.checkInTime && !attendance.checkOutTime ? 'Checked-In' : 'Not Checked-In';

      return res.json({
        message: 'Current shift found.',
        currentShift: {
          shiftName: currentShift.shiftName,
          shiftStart: currentShift.shiftStart,
          shiftEnd: currentShift.shiftEnd,
          status,
        },
      });
    }

    // Find the next shift (if current time is after the last shift end)
    const nextShift = shifts.find((shift) => {
      const shiftStartTime = new Date(`${currentDate} ${shift.shiftStart}`);
      return now < shiftStartTime;
    });

    if (nextShift) {
      return res.json({
        message: 'Next shift found.',
        nextShift: {
          shiftName: nextShift.shiftName,
          shiftStart: nextShift.shiftStart,
          shiftEnd: nextShift.shiftEnd,
          status: 'Not Checked-In', // Default status for next shift
        },
      });
    }

    return res.status(404).json({ error: 'No ongoing or upcoming shifts found.' });
  } catch (error) {
    console.error('Error fetching current shift status:', error);
    res.status(500).json({ error: 'Error fetching current shift status' });
  }
});
router.post('/verifyFace', async (req, res) => {
  try {
    const { employeeId, capturedImageUrl } = req.body;

    if (!employeeId || !capturedImageUrl) {
      return res.status(400).json({ error: 'Invalid request. Missing parameters.' });
    }

    // Find user by employeeId and get profilePic from DB
    const user = await User.findOne({ employeeId });
    if (!user || !user.profilePic) {
      return res.status(404).json({ error: 'User not found or profile picture missing' });
    }

    // Compare faces
    const isFaceMatched = await compareFaces(user.profilePic, capturedImageUrl);

    if (isFaceMatched) {
      console.log("Face matched successfully!");
      return res.json({ message: 'Face verification successful. Proceeding to mark attendance.' });
    } else {
      console.log("Face not matched!");
      return res.status(403).json({ error: 'Face not recognized. Access denied.' });
    }
  } catch (error) {
    console.error('Error during face verification:', error);
    res.status(500).json({ error: 'Internal server error during face verification.' });
  }
});
// Load face-api.js models on server startup
loadModels()
  .then(() => console.log('Face API models loaded successfully'))
  .catch((error) => console.error('Error loading Face API models:', error));
// const markAttendance = async(employeeId, location, timestamp, type) => {


//   // Validate location data

//   try {
//     // Fetch office location
//     const officeLocation = await OfficeLocation.findOne();
//     if (!officeLocation) {
//       console.error('Office location not found');
//       throw new Error('Office location not found');
//     }

//     // Fetch employee details
//     const user = await User.findOne({ employeeId });
//     if (!user) {
//       console.error('User not found for employeeId:', employeeId);
//       throw new Error('User not found');
//     }

//     staffType = user.staffType;

//     // Get the current date
//     const now = new Date(timestamp);
//     const currentDate = now.toDateString();
//     console.log('Current Date:', currentDate);

//     // Check for weekoff
//     const dayOfWeek = now.toLocaleString('en-US', { weekday: 'long' });
//     if (user.weekoffSchedule.includes(dayOfWeek)) {
//       console.log(`Today (${dayOfWeek}) is a weekoff for employeeId: ${employeeId}`);

//       // Check if weekoff attendance is already marked
//       let attendance = await Attendance.findOne({ employeeId, date: currentDate });
//       if (!attendance) {
//         attendance = new Attendance({
//           employeeId,
//           name: user.name,
//           date: currentDate,
//           shiftName: 'N/A',
//           location: 'Weekoff',
//           checkInTime: '0', // Set check-in time to 0
//           checkOutTime: '0', // Set check-out time to 0
//           status: 'Weekoff',
//           hoursWorked: 0,
//           overtimeHours: 0,
//           underTimeHours: 0,
//         });

//         await attendance.save();
//         console.log('Weekoff attendance marked successfully:', attendance);
//         return attendance;
//       }

//       console.error('Weekoff attendance already marked for today');
//       throw new Error('Weekoff attendance already marked for today.');
//     }

//     // Reverse geocoding for address
//     let address = 'Unknown Location';
//     const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${location.latitude}&lon=${location.longitude}`;

//     try {
//       const response = await axios.get(nominatimUrl);
//       address = response.data.display_name || 'Unknown Location';
//       console.log('Fetched Address:', address);
//     } catch (error) {
//       console.error('Error fetching address from Nominatim:', error.message);
//     }

//     // Geofence check for regular staff
//     const distance = calculateDistance(
//       location.latitude,
//       location.longitude,
//       officeLocation.latitude,
//       officeLocation.longitude
//     );
//     console.log('Distance from office:', distance, 'Radius:', officeLocation.radius);
//     if (distance > officeLocation.radius && staffType === 'regular') {
//       console.error('Outside authorized area for attendance');
//       throw new Error('You are outside the authorized area for attendance.');
//     }

//     // Parse shift times
//     const shift = await User.findOne({ employeeId });
//     if (!shift) {
//       console.error('Shift assignment not found for employeeId:', employeeId);
//       throw new Error('Shift assignment not found for employee.');
//     }

//     const shiftStartTime = new Date(`${currentDate} ${shift.shiftTime.start}`);
//     const shiftEndTime = new Date(`${currentDate} ${shift.shiftTime.end}`);
//     console.log('Shift Start Time:', shiftStartTime, 'Shift End Time:', shiftEndTime);

//     // Attendance operations: Check-In or Check-Out
//     let attendance = await Attendance.findOne({ employeeId, date: currentDate });

//     if (type === 'Check-In') {
//       if (attendance) {
//         console.error('Check-In already exists for this employee and date');
//         throw new Error('Check-In already marked for this employee on this date.');
//       }

//       if (now < shiftStartTime || now > shiftEndTime) {
//         console.error('Check-In outside shift time');
//         throw new Error('Attendance can only be marked during shift time.');
//       }

//       attendance = new Attendance({
//         employeeId,
//         name: user.name,
//         date: currentDate,
//         shiftName: shift.shiftName,
//         location: address,
//         staffType,
//         checkInTime: now,
//         status: 'Checked-In',
//       });

//       await attendance.save();
//       console.log('Check-In successful:', attendance);
//       return attendance;
//     } else if (type === 'Check-Out') {

//       const checkInTime = new Date(attendance.checkInTime);
//       const formattedHoursWorked = (now - checkInTime) / (1000 * 60 * 60);
//       const shiftHours = shift.duration || 8;
//       const overtime = formattedHoursWorked > shiftHours ? formattedHoursWorked - shiftHours : 0;
//       const underTime = formattedHoursWorked < shiftHours ? shiftHours - formattedHoursWorked : 0;

//       attendance.checkOutTime = now;
//       attendance.hoursWorked = formattedHoursWorked;
//       attendance.overtimeHours = overtime;
//       attendance.underTimeHours = underTime;
//       attendance.status = formattedHoursWorked >= shiftHours ? 'P' : 'U';

//       await attendance.save();
//       console.log('Check-Out successful:', attendance);
//       return attendance;
//     }

//     console.error('Invalid attendance type:', type);
//     throw new Error('Invalid attendance type.');
//   } catch (error) {
//     console.error('Error marking attendance:', error);
//     throw error;
//   }
// }
// router.post('/markAttendance', async (req, res) => {
//   const { employeeId, location, timestamp, type } = req.body;
//   if (
//     !location ||
//     typeof location.latitude !== 'number' ||
//     typeof location.longitude !== 'number'
//   ) {
//     console.error('Invalid or missing location data:', location);
//     throw new({ error: 'Invalid or missing location data' });
//   }
//   if (!location || !location.latitude || !location.longitude) {
//     throw new Error('Invalid location. Latitude and longitude are required.');
//   }

//   console.log('Received Request:', req.body);

//   if (!employeeId || !location || !location.latitude || !location.longitude || !timestamp || !type) {
//     return res.status(400).json({ 
//       error: 'Invalid request. Please provide employeeId, location (latitude & longitude), timestamp, and type.' 
//     });
//   }

//   try {
//     const attendance = await markAttendance(employeeId, location, timestamp, type);
//     return res.json({ message: 'Attendance marked successfully', attendance });
//   } catch (error) {
//     console.error('Error marking attendance:', error.message);
//     return res.status(500).json({ error: error.message });
//   }
// });



// cron.schedule('*/1 * * * *', async () => {
//   console.log('Running weekoff attendance cron job...');
  
//   try {
//     // Fetch all employees
//     const users = await User.find();
//     const now = new Date();
//     const currentDate = now.toDateString();
//     const dayOfWeek = now.toLocaleString('en-US', { weekday: 'long' });

//     for (const user of users) {
//       if (user.weekoffSchedule.includes(dayOfWeek)) {
//         console.log(`Marking weekoff attendance for employeeId: ${user.employeeId}`);

//         // Check if attendance is already marked
//         let attendance = await Attendance.findOne({ employeeId: user.employeeId, date: currentDate });
//         if (!attendance) {
//           // Automatically mark weekoff attendance
//           attendance = new Attendance({
//             employeeId: user.employeeId,
//             name: user.name,
//             date: currentDate,
//             shiftName: 'N/A',
//             location: 'Weekoff',
//             checkInTime: '0', // Set check-in time to 0
//             checkOutTime: '0', // Set check-out time to 0
//             status: 'Weekoff',
//             hoursWorked: 0,
//             overtimeHours: 0,
//             underTimeHours: 0,
//           });

//           await attendance.save();
//           console.log(`Weekoff attendance marked successfully for employeeId: ${user.employeeId}`);
//         } else {
//           console.log(`Weekoff attendance already marked for employeeId: ${user.employeeId}`);
//         }
//       }
//     }
//     console.log('Weekoff attendance cron job completed.');
//   } catch (error) {
//     console.error('Error running weekoff attendance cron job:', error);
//   }
// });


const markAbsent = async () => {
  try {
    const today = new Date().toDateString(); // Get today's date
    const employees = await User.find({}); // Fetch all employees

    for (const employee of employees) {
      const shifts = employee.shifts || []; // Assuming `shifts` contains assigned shifts for the employee

      for (const shift of shifts) {
        const shiftStartTime = new Date();
        const shiftEndTime = new Date();

        // Parse the shift's start and end time
        const { hours: startHours, minutes: startMinutes } = parseTimeTo24Hour(shift.startTime);
        const { hours: endHours, minutes: endMinutes } = parseTimeTo24Hour(shift.endTime);

        shiftStartTime.setHours(startHours, startMinutes, 0, 0);
        shiftEndTime.setHours(endHours, endMinutes, 0, 0);

        // Check if attendance record exists for the current date and shift
        const existingAttendance = await Attendance.findOne({
          employeeId: employee.employeeId,
          date: today,
          shiftName: shift.shiftName,
        });

        const dayOfWeek = new Date().toLocaleString('en-US', { weekday: 'long' });

        // Mark as absent if:
        // 1. No attendance record exists OR
        // 2. No valid check-in time OR
        // 3. The employee's check-in time is outside the shift hours AND
        // 4. It's not the employee's week-off
        if (
          (!existingAttendance ||
            !existingAttendance.checkInTime ||
            new Date(existingAttendance.checkInTime) < shiftStartTime ||
            new Date(existingAttendance.checkInTime) > shiftEndTime) &&
          (!employee.weekoffSchedule || !employee.weekoffSchedule.includes(dayOfWeek))
        ) {
          console.log(`Marking employee ${employee.employeeId} absent for shift ${shift.shiftName}`);

          // Create a new attendance record for the absent employee
          let attendance = await Attendance.findOne({
            employeeId: employee.employeeId,
            date: today,
          });

          if (!attendance) {
            attendance = new Attendance({
              employeeId: employee.employeeId,
              name: employee.name,
              date: today,
              shiftName: 'N/A', // Assign the shift name
              location: 'A', // Mark as absent location
              checkInTime: null, // Set check-in time to null (or '0' if preferred)
              checkOutTime: null, // Set check-out time to null
              status: 'A', // 'A' stands for absent
              hoursWorked: 0, // 0 hours worked
              overtimeHours: 0, // 0 overtime hours
              underTimeHours: 0, // 0 undertime hours
            });

            await attendance.save();
            console.log(`Attendance marked as absent for employee ${employee.employeeId}`);
          }
        }
      }
    }

    console.log('Absent statuses updated for employees with missing or invalid attendance records.');
  } catch (error) {
    console.error('Error updating absent statuses:', error);
  }
};

// Utility function to parse time strings into 24-hour format
function parseTimeTo24Hour(timeString) {
  const [time, modifier] = timeString.split(' '); // Split into time and AM/PM
  let [hours, minutes] = time.split(':').map(Number);

  if (modifier === 'PM' && hours !== 12) {
    hours += 12; // Convert PM to 24-hour format
  } else if (modifier === 'AM' && hours === 12) {
    hours = 0; // Convert 12 AM to 0 (midnight)
  }

  return { hours, minutes };
}

// Schedule the job to run at midnight
cron.schedule('0 0 * * *', async () => { // Changed to run at midnight every day
  console.log('Running absent marking job...');
  await markAbsent();
});

router.get('/attendance', protect, async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'Employee ID not found in the request' });
    }

    const currentDate = new Date().toDateString(); // Fri Jan 10 2025
    const currentTime = new Date(); // Current time
    console.log('Current Date:', currentDate);
    console.log('Current Time:', currentTime);

    // Fetch today's attendance records
    const attendances = await Attendance.find({
      employeeId,
      date: currentDate,
      checkOutTime: { $exists: false }, // Filter for active shifts only
    }).lean();

    console.log('Attendance Records:', attendances);

    if (!attendances.length) {
      return res.json({ success: true, data: [], message: 'No active attendance records for today.' });
    }

    // Fetch all shift assignments for the employee
    const shiftAssignments = await ShiftAssignment.find({ employeeId }).lean();
    console.log('Shift Assignments:', shiftAssignments);

    if (!shiftAssignments.length) {
      return res.status(404).json({ success: false, message: 'No shift assignments found for this employee.' });
    }

    // Map attendance records to their corresponding shifts
    const activeShifts = attendances
      .map((attendance) => {
        const shift = shiftAssignments.find(
          (shift) => shift.shiftId.toString() === attendance.shiftId.toString() // Match shiftId as strings
        );

        if (shift) {
          // Combine currentDate with shiftEnd to create a full Date object for comparison
          const shiftEndDate = new Date(`${currentDate} ${shift.shiftEnd}`); // "Fri Jan 10 2025 2:00 PM"
          console.log('Shift End Date:', shiftEndDate);
          
          // Check if the current time is before the shiftEnd time
          if (currentTime < shiftEndDate) {
            return {
              ...attendance,
              shiftName: shift.shiftName,
              shiftStart: shift.shiftStart,
              shiftEnd: shift.shiftEnd,
            };
          }
        }
        return null;
      })
      .filter(Boolean); // Remove null values (i.e., inactive shifts)

    console.log('Active Shifts:', activeShifts);

    if (!activeShifts.length) {
      return res.json({ success: true, data: [], message: 'No active attendance records for the remaining shifts.' });
    }

    // Format the attendance data
    const formattedAttendances = activeShifts.map((attendance) => ({
      date: attendance.date,
      shiftName: attendance.shiftName,
      shiftStart: attendance.shiftStart,
      shiftEnd: attendance.shiftEnd,
      checkInTime: attendance.checkInTime
        ? new Date(attendance.checkInTime).toLocaleTimeString('en-US')
        : '-',
      checkOutTime: attendance.checkOutTime
        ? new Date(attendance.checkOutTime).toLocaleTimeString('en-US')
        : '-',
      status: attendance.checkInTime
        ? attendance.checkOutTime
          ? 'Present'
          : 'Checked-In'
        : 'Absent',
      hoursWorked: attendance.hoursWorked || 0,
      overtimeHours: attendance.overtimeHours || 0,
      underTimeHours: attendance.underTimeHours || 0,
    }));

    console.log('Formatted Attendances:', formattedAttendances);
    res.json({ success: true, data: formattedAttendances });
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ success: false, message: 'Error fetching attendance data' });
  }
});



router.get('/salary/attendance', async (req, res) => {
  try {
    const { employeeId } = req.query;
    if (!employeeId) {
      return res.status(400).json({ message: 'employeeId is required' });
    }
    const attendanceRecords = await Attendance.find({ employeeId });
    if (!attendanceRecords.length) {
      return res.status(404).json({ message: 'No attendance records found' });
    }
    res.status(200).json(attendanceRecords);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/weekly-attendance',protect, async (req, res) => {
  try {
    const employeeId = req.user.employeeId; // Expect employeeId as a query parameter

    if (!employeeId) {
      return res.status(400).json({ message: 'Employee ID is required' });
    }

    // Fetch attendance data for the logged-in employee
    const attendanceRecords = await Attendance.find({ employeeId });

    res.status(200).json(attendanceRecords);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});// Ensure 'protect' middleware is applied for authentication
router.get('/monthly-attendance', protect, async (req, res) => {
  const { month } = req.query; // Expected format: "2024-12"
  const employeeId = req.user.employeeId; // Ensure the logged-in user's employee ID is used

  if (!month) {
    return res.status(400).json({ error: 'Month is required in YYYY-MM format.' });
  }

  try {
    // Parse start and end of the month in ISO format
    const [year, monthNumber] = month.split('-');
    const startOfMonth = new Date(`${year}-${monthNumber}-01T00:00:00.000Z`);
    const endOfMonth = new Date(year, monthNumber, 0, 23, 59, 59, 999);

    // Fetch all attendance records for the logged-in employee
    const attendanceData = await Attendance.find({ employeeId }).lean();

    // Filter records by parsing the stored format and checking the date range
    const filteredData = attendanceData.filter(record => {
      const recordDate = new Date(record.date); // Convert "Mon Dec 02 2024" to a JavaScript Date object
      return recordDate >= startOfMonth && recordDate <= endOfMonth;
    });

    if (filteredData.length === 0) {
      return res.status(404).json({ message: 'No attendance data for the selected month.' });
    }

    // Convert each record's date to ISO string format before sending the response
    const responseData = filteredData.map(record => ({
      ...record,
      date: new Date(record.date).toISOString(), // Convert date to ISO string
    }));

    // Send the processed data
    res.json(responseData);
    console.log(responseData);

  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/attendance/report', async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }

    // Convert the incoming date to match MongoDB string format
    const queryDate = new Date(date).toDateString(); // e.g., "Wed Dec 04 2024"

    // Fetch attendance records with the matching string date
    const attendanceRecords = await Attendance.find({
      date: queryDate,
    });

    if (!attendanceRecords || attendanceRecords.length === 0) {
      return res.status(404).json({ error: 'No attendance records found for the selected date' });
    }

    res.json(attendanceRecords);
  } catch (error) {
    console.error('Error fetching attendance records:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// module.exports = { markAttendance };
module.exports = router;





