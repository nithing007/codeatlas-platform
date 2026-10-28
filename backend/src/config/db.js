/**
 * MongoDB connection module
 * Handles initial connection and logs connection events.
 */

const mongoose = require('mongoose');
const config = require('./index');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.mongodbUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`MongoDB connection error: ${error.message}`);
    if (config.nodeEnv === 'production') {
      process.exit(1);
    }
    console.warn('Server starting without database connection. Some features will be unavailable.');
  }
};

module.exports = connectDB;
