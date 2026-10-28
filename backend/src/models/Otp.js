/**
 * OTP model
 * Stores hashed OTPs for email verification.
 * Records auto-expire via MongoDB TTL index on expiresAt.
 * Unique index on email ensures only one active OTP per email address.
 */

const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  hashedOtp: {
    type: String,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  attempts: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Only one active OTP per email — inserting a new one for the same email
// requires deleting the old one first (handled in authService).
otpSchema.index({ email: 1 }, { unique: true });

// MongoDB automatically deletes documents when expiresAt passes.
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Otp = mongoose.model('Otp', otpSchema);

module.exports = Otp;
