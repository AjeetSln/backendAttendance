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
  const { name, email, password, mobile, category, address, aadhar, staffType, salary,role } = req.body;

  // Ensure all required fields are provided
  if (!name || !email || !password || !mobile || !category || !aadhar) {
    return res.status(400).json({ message: 'Please provide name, email, password, mobile, category, and aadhar' });
  }

  // Validate mobile number to be exactly 10 digits
  const mobileRegex = /^[0-9]{10}$/;
  if (!mobileRegex.test(mobile)) {
    return res.status(400).json({ message: 'Mobile number must be exactly 10 digits' });
  }

  // Validate name to contain only letters and spaces
  const nameRegex = /^[A-Za-z\s]+$/;
  if (!nameRegex.test(name)) {
    return res.status(400).json({ message: 'Name must contain only letters and spaces' });
  }

  // Check if user already exists
  const userExists = await User.findOne({ email, mobile });
  if (userExists) {
    return res.status(400).json({ message: 'User already exists' });
  }

  try {
    // Get the next available Employee ID
    const employeeId = await getNextEmployeeId();

    // Create new employee without hashing the password
    const user = new User({
      employeeId,
      name,
      email,
      password, // Storing plain password directly
      role, // Hardcoded role as 'employee'
      mobile,
      category,
      address,
      aadhar,
      staffType,
      salary,
      profilePic: req.file ? req.file.path : null, // Save uploaded profile pic path
    });

    // Save new employee to the database
    await user.save();

    // Send email with Employee ID and plain password
    const emailBody = `Dear ${name},\n\nYour employee account has been created successfully.\n\nEmployee ID: ${employeeId}\nPassword: ${password}\n\nPlease log in to the employee portal to get started.\n\nRegards,\nYour Company`;
    await sendEmail(email, 'Welcome to the Team!', emailBody);

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
    const user = await User.findById(req.user.id).select('-password');
    res.json({
      employeeId: user.employeeId || '',
      name: user.name || '',
      category: user.category || '',
      profilePic: user.profilePic || '', // Default to an empty string
      staffType: user.staffType || '',
      email: user.email || '',
      mobile: user.mobile || '',
      address: user.address || '',
      weekoffSchedule :user.weekoffSchedule || '',
    });
  } catch (error) {
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



router.put('/employees/:id', protect, admin, async (req, res) => {
  try {
    const employeeId = req.params.id;
    
    // Check if the employeeId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ message: 'Invalid employee ID' });
    }

    const employee = await User.findById(employeeId);

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    const updatedData = {
      name: req.body.name,
      email: req.body.email,
      mobile: req.body.mobile,
      password : req.body.password,
      category: req.body.category,
      staffType: req.body.staffType,
      address: req.body.address,
      aadhar: req.body.aadhar,
      salary: req.body.salary,
    };

    Object.assign(employee, updatedData); // Update employee fields
    await employee.save();

    res.json(employee);
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
