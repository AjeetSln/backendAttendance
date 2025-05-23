const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Counter = require('../models/Counter');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const dotenv = require('dotenv');
const { protect, admin } = require('../Middleware/authMiddleware');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');


dotenv.config();
const router = express.Router();

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer storage for Cloudinary
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'profile-pics',
    allowed_formats: ['jpg', 'jpeg', 'png'],
  },
});

const upload = multer({ storage });
 

// Setup Nodemailer transporter for Gmail with App Password
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // Your Gmail address
    pass: process.env.EMAIL_PASSWORD, // Your Gmail App Password (not your regular Gmail password)
  },
  tls: {
    rejectUnauthorized: false,
  },
});

// Function to get the next Employee ID (auto-increment logic)
async function getNextEmployeeId() {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'employeeId' },
    { $inc: { count: 1 } }, // Increment the counter
    { new: true, upsert: true } // Create a new document if not exists
  );
  return `Ats${String(counter.count).padStart(5, '0')}`; // Format employee ID as AtsXXXXX
}

// Store OTP temporarily (this should be stored in a more persistent store like Redis in production)
const otps = {}; // { employeeId: otp }

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
}
const sendEmail = async (to, subject, body) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail', // Use your email provider
    auth: {
      user: process.env.EMAIL_USER, // Your email
      pass: process.env.EMAIL_PASSWORD, // App password
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject,
    text: body,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${to}`);
  } catch (error) {
    console.error('Error sending email:', error);
  }
};


// Admin Register Employee with Auto-Increment Employee ID
router.post('/register-employee', protect, admin, upload.single('profilePic'), async (req, res) => {
  const { name, email, password, mobile, category, address, aadhar, staffType, salary, role } = req.body;

  try {
    // Start performance timer
    console.time('RegisterEmployee');

    // Input validation
    const mobileRegex = /^[0-9]{10}$/;
    const nameRegex = /^[A-Za-z\s]+$/;

    if (!name || !email || !password || !mobile || !category || !aadhar) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    if (!mobileRegex.test(mobile)) {
      return res.status(400).json({ message: 'Invalid mobile number format' });
    }
    if (!nameRegex.test(name)) {
      return res.status(400).json({ message: 'Invalid name format' });
    }

    // Check if user exists
    const userExists = await User.findOne({ $or: [{ email }, { mobile }] }).lean();
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    console.timeLog('RegisterEmployee', 'Validation completed');

    // Get next employee ID
    const employeeId = await getNextEmployeeId();
    console.timeLog('RegisterEmployee', 'Employee ID generated');

    // Create new user data object
    const userData = {
      employeeId,
      name,
      email,
      password, // Storing plain password (not recommended for production)
      role,
      mobile,
      category,
      address,
      aadhar,
      staffType,
      salary,
      profilePic: req.file?.path || null, // Use uploaded path if available
    };

    // Save user to database and send email in parallel
    const emailBody = `Dear ${name},\n\nYour employee account has been created successfully.\n\nEmployee ID: ${employeeId}\nPassword: ${password}\n\nPlease log in to the employee portal to get started.\n\nRegards,\nYour Company`;
    const emailPromise = sendEmail(email, 'Welcome to the Team!', emailBody);

    // Save user to database
    const saveUserPromise = User.create(userData);

    // Execute both promises concurrently
    await Promise.all([emailPromise, saveUserPromise]);

    console.timeLog('RegisterEmployee', 'User saved and email sent');
    console.timeEnd('RegisterEmployee');

    res.status(201).json({ message: 'Employee registered successfully and email sent.' });
  } catch (error) {
    console.error('Error registering employee:', error);
    res.status(500).json({ message: 'Error registering employee' });
  }
});


// Login route for Admin or Employee (with ID/Email and Password)

router.post('/login', async (req, res) => {
  const { employeeId, email, password, role } = req.body;

  if ((!employeeId && !email) || !password || !role) {
    return res.status(400).json({ message: 'Invalid input' });
  }

  if (!['admin', 'employee'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role' });
  }

  try {
    const query = role === 'admin' ? { email, role: 'admin' } : { employeeId, role: 'employee' };
    const user = await User.findOne(query);

    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (role === 'employee') {
      // Generate OTP and cache it
      const otp = generateOTP();
      otps[employeeId] = otp;

      // Send OTP email
      transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Login OTP',
        text: `Your OTP is: ${otp}. It is valid for 5 minutes.`,
      });

      return res.status(200).json({ otpSent: true, message: 'OTP sent to your email' });
    }

    // Generate JWT for admin
    const token = jwt.sign({ user: { id: user._id, role } }, process.env.JWT_SECRET, {
      expiresIn: '30d',
    });
    return res.status(200).json({ token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// OTP verification route
router.post('/verify-otp', async (req, res) => {
  const { employeeId, otp } = req.body;

  if (!employeeId || !otp) {
    return res.status(400).json({ message: 'Invalid input' });
  }

  try {
    if (otps[employeeId] && otps[employeeId] === otp) {
      delete otps[employeeId]; // OTP used, remove it from cache

      const user = await User.findOne({ employeeId, role: 'employee' });
      const token = jwt.sign({ user: { id: user._id, role: user.role } }, process.env.JWT_SECRET, {
        expiresIn: '30d',
      });

      return res.status(200).json({ message: 'OTP verified', token });
    }

    return res.status(400).json({ message: 'Invalid OTP' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});


// Profile route
router.get('/profile', protect, async (req, res) => {
  try {
    // Using lean() to get plain objects without Mongoose document overhead
    const user = await User.findById(req.user.id)
      .select('employeeId name category profilePic staffType email mobile address weekoffSchedule')
      .lean();

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      employeeId: user.employeeId || '',
      name: user.name || '',
      category: user.category || '',
      profilePic: user.profilePic || '',  // Default to an empty string
      staffType: user.staffType || '',
      email: user.email || '',
      mobile: user.mobile || '',
      address: user.address || '',
      weekoffSchedule: user.weekoffSchedule || '',
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ message: 'Error retrieving profile', error });
  }
});

router.get('/employees', protect, admin, async (req, res) => {
  try {
    const employees = await User.find({ role: 'employee' }).select('-password'); // Fetch all employees, excluding their passwords
    res.json(employees);
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving employees' });
  }
});


router.get('/employees/:employeeId', protect, async (req, res) => {
  

  
    try {
      const employee = await User.findById(req.user.id).select('-password');
      if (employee) {
        return res.json(employee);
      }
      return res.status(404).json({ message: 'Employee not found' });
    } catch (error) {
      return res.status(500).json({ message: 'Error fetching employee data', error });
    }
});



router.put('/employees/:id', protect, admin, upload.single('profilePic'), async (req, res) => {
  try {
    const employeeId = req.params.id;

    // Validate employee ID
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ message: 'Invalid employee ID' });
    }

    // Find the employee
    const employee = await User.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    // Extract updated data from request
    const updatedData = {
      name: req.body.name,
      email: req.body.email,
      mobile: req.body.mobile,
      password: req.body.password,
      category: req.body.category,
      staffType: req.body.staffType,
      address: req.body.address,
      aadhar: req.body.aadhar,
      salary: req.body.salary,
    };

    // Handle profile picture update
    if (req.file) {
      updatedData.profilePic = req.file.path; // Use new profile picture path if provided
    }

    // Update the employee with the new data
    Object.assign(employee, updatedData);
    await employee.save();

    res.json({ message: 'Employee updated successfully', employee });
  } catch (error) {
    res.status(500).json({ message: 'Error updating employee', error: error.message });
  }
});

router.delete('/employees/:employeeId', protect, admin, async (req, res) => {
  try {
    const { employeeId } = req.params; // Get the employeeId from the route parameter
    
    // Find the employee by custom employeeId, not _id
    const employee = await User.findOneAndDelete({ employeeId: employeeId });

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    res.status(200).json({ message: 'Employee deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting employee', error: error.message });
  }
});




module.exports = router;
