const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const connectDB = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB Connected');

    // Once connected, modify the indexes
    const attendanceCollection = mongoose.connection.collection('attendances');

    // Drop the old index if it exists
    await attendanceCollection.dropIndex("date_1_employeeId_1", (err, result) => {
      if (err && err.code !== 27) {  // Ignore error if the index doesn't exist
        console.error('Error dropping index:', err);
      } else {
        console.log('Old index dropped:', result);
      }
    });

    // Create the new unique index on `date` and `employeeId`
    await attendanceCollection.createIndex({ date: 1, employeeId: 1,shiftId: 1 }, { unique: true });
    console.log('New index created on date and employeeId.');

  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
};


module.exports = connectDB;
