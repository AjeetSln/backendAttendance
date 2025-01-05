const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Attendance = require ('../models/Attendance');

// Middleware to protect routes (ensure the user is logged in)
const protect = async (req, res, next) => {
  let token;

  // Check if the token is included in the authorization header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1]; // Extract token

      // Verify the token using JWT_SECRET (from .env or environment variables)
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Ensure decoded.user.id exists before querying the database
      if (!decoded.user || !decoded.user.id) {
        return res.status(401).json({ message: 'Invalid token, no user id found' });
      }

      // Attach the user from the payload to the request object
      const user = await User.findById(decoded.user.id).select('-password');

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      req.user = user;  // Set the user object on the request

      // console.log('User data:', req.user); // Optional: Log user data for debugging
      next(); // Proceed to the next middleware or route handler
    } catch (error) {
      console.error(error);
      // Check if the error is due to an expired token
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Token expired, please log in again' });
      }
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  } else {
    // If there is no token in the request, send an error response
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};


// Middleware for admin access only
const admin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authorized, no user found' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Not authorized as an admin' });
  }

  next(); // Proceed to the next middleware or route handler
};

module.exports = { protect, admin };
