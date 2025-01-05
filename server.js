const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db'); // Connect to the MongoDB database
const userRoutes = require('./routes/authRoutes'); // Import user authentication routes
const markAttendances = require('./routes/attendanceRoutes');
const Shift = require('./routes/ShiftRouts');
const Leave = require('./routes/LeaveRoutes');
const email = require('./routes/emailRoutes');
const salaryRoutes = require('./routes/salaryRoutes');
const cors = require('cors');
const bodyParser = require('body-parser');
const fileUpload = require('express-fileupload');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cluster = require('cluster');
const os = require('os');
const redis = require('redis'); // Redis for caching

// Load environment variables from .env file
dotenv.config();

// Connect to the MongoDB database
connectDB();

// Redis client for caching
const client = redis.createClient();

// Initialize Express app
const app = express();

// Middleware to parse incoming JSON data
app.use(express.json());
app.use(fileUpload({
  limits: { fileSize: 10 * 1024 * 1024 },  // 10MB limit
  abortOnLimit: true,
  useTempFiles: true,
  tempFileDir: '/tmp/'
}));

// Enable Cross-Origin Resource Sharing (CORS)
app.use(cors({ origin: '*' }));

// Compression middleware for faster responses
app.use(compression());

// Rate limiting to avoid abuse
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests, please try again later.'
});
app.use(limiter);

// Set up the authentication API routes
app.use('/api/auth', userRoutes);
app.use('/api', markAttendances);
app.use('/api/Shift', Shift);
app.use('/api', Leave);
app.use('/api/email', email);
app.use(bodyParser.json()); // for large JSON payloads
app.use(bodyParser.urlencoded({ extended: true })); // for form data if needed
app.use('/api', salaryRoutes);

// Timeout handler
app.use((req, res, next) => {
  res.setTimeout(500000, () => { // Set timeout to 500 seconds (example)
    console.log('Request timed out');
    res.status(408).send('Request Timeout');
  });
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (err.status === 413) {
    return res.status(413).json({ error: 'File too large. Max limit is 10MB' });
  }
  console.error(err.stack); // For logging the error
  res.status(500).send({ error: 'Something went wrong!' }); // Generic error response
});

// Cluster mode for handling multiple cores
if (cluster.isMaster) {
  const numCPUs = os.cpus().length;
  console.log(`Master process is running. Forking ${numCPUs} workers...`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`);
  });
} else {
  // Server setup for each worker process
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Worker ${process.pid} started on port ${PORT}`);
  });
}
