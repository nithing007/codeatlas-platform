/**
 * Authentication service
 * Business logic for the email OTP authentication flow.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Otp = require('../models/Otp');
const { generateToken } = require('./jwtService');
const { sendOtpEmail } = require('./emailService');
const config = require('../config');

// ---------- Helpers ----------

/**
 * Validate email format.
 * @param {string} email
 * @returns {boolean}
 */
const isValidEmail = (email) => {
  return /^\S+@\S+\.\S+$/.test(email);
};

/**
 * Generate a cryptographically secure 6-digit OTP.
 * crypto.randomInt is CSPRNG-backed — safe for security-sensitive use.
 * @returns {string} 6-digit OTP string.
 */
const generateOtp = () => {
  return crypto.randomInt(100000, 999999).toString();
};

// ---------- Service Methods ----------

/**
 * Request a new OTP for the given email.
 * - Validates email format
 * - Enforces resend cooldown
 * - Generates, hashes, and stores OTP
 * - Sends OTP via email service
 *
 * @param {string} email
 * @returns {Object} { message }
 */
const requestOtp = async (email) => {
  if (!email || !isValidEmail(email)) {
    const error = new Error('Please provide a valid email address');
    error.statusCode = 400;
    throw error;
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Check resend cooldown — if an OTP was created recently, reject
  const existingOtp = await Otp.findOne({ email: normalizedEmail });

  if (existingOtp) {
    const secondsSinceCreated = (Date.now() - existingOtp.createdAt.getTime()) / 1000;
    const cooldown = config.otpResendCooldownSeconds;

    if (secondsSinceCreated < cooldown) {
      const remainingSeconds = Math.ceil(cooldown - secondsSinceCreated);
      const error = new Error(
        `Please wait ${remainingSeconds} seconds before requesting a new code`
      );
      error.statusCode = 429;
      throw error;
    }
  }

  // Generate and hash OTP
  const otp = generateOtp();
  const salt = await bcrypt.genSalt(10);
  const hashedOtp = await bcrypt.hash(otp, salt);

  // Calculate expiration
  const expiresAt = new Date(Date.now() + config.otpExpiresMinutes * 60 * 1000);

  // Upsert — delete any existing OTP for this email and create a new one
  await Otp.findOneAndDelete({ email: normalizedEmail });
  await Otp.create({
    email: normalizedEmail,
    hashedOtp,
    expiresAt,
  });

  // Send OTP through email service
  await sendOtpEmail(normalizedEmail, otp);

  return { message: 'Verification code sent to your email' };
};

/**
 * Verify an OTP and authenticate the user.
 * - Validates inputs
 * - Checks expiration and attempt limits
 * - Compares OTP hash
 * - Creates user if new, or finds existing user
 * - Returns user info and JWT
 *
 * @param {string} email
 * @param {string} otp
 * @returns {Object} { user, token }
 */
const verifyOtp = async (email, otp) => {
  if (!email || !isValidEmail(email)) {
    const error = new Error('Please provide a valid email address');
    error.statusCode = 400;
    throw error;
  }

  if (!otp || !/^\d{6}$/.test(otp)) {
    const error = new Error('Please provide a valid 6-digit verification code');
    error.statusCode = 400;
    throw error;
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Find active OTP record
  const otpRecord = await Otp.findOne({ email: normalizedEmail });

  if (!otpRecord) {
    const error = new Error('No verification code found. Please request a new one');
    error.statusCode = 401;
    throw error;
  }

  // Check expiration
  if (otpRecord.expiresAt < new Date()) {
    await Otp.findByIdAndDelete(otpRecord._id);
    const error = new Error('Verification code has expired. Please request a new one');
    error.statusCode = 401;
    throw error;
  }

  // Check attempt limit
  if (otpRecord.attempts >= config.otpMaxAttempts) {
    await Otp.findByIdAndDelete(otpRecord._id);
    const error = new Error('Maximum verification attempts exceeded. Please request a new code');
    error.statusCode = 401;
    throw error;
  }

  // Compare OTP with stored hash
  const isMatch = await bcrypt.compare(otp, otpRecord.hashedOtp);

  if (!isMatch) {
    // Increment attempt counter
    otpRecord.attempts += 1;
    await otpRecord.save();

    const remainingAttempts = config.otpMaxAttempts - otpRecord.attempts;
    const error = new Error(
      `Invalid verification code. ${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining`
    );
    error.statusCode = 401;
    throw error;
  }

  // OTP is valid — delete it so it cannot be reused
  await Otp.findByIdAndDelete(otpRecord._id);

  // Find or create user
  let user = await User.findOne({ email: normalizedEmail });
  let isNewUser = false;

  if (!user) {
    user = await User.create({
      email: normalizedEmail,
      authProvider: 'email',
    });
    isNewUser = true;
  }

  // Generate JWT with minimal payload
  const token = generateToken({ id: user._id, role: user.role });

  return {
    user: user.toSafeObject(),
    token,
    isNewUser,
  };
};

/**
 * Handle Google OAuth authentication:
 * - Links googleId if an existing account with the same email exists
 * - Or authenticates user by googleId
 * - Or creates a new user if no match exists
 * - Returns safe user, JWT token, and isNewUser flag
 *
 * @param {Object} googleUser - { googleId, email, name, profilePicture }
 * @returns {Promise<Object>} { user, token, isNewUser }
 */
const handleGoogleAuth = async (googleUser) => {
  if (!googleUser || !googleUser.googleId || !googleUser.email) {
    const error = new Error('Invalid Google user data');
    error.statusCode = 400;
    throw error;
  }

  const normalizedEmail = googleUser.email.toLowerCase().trim();

  // 1. Try finding user by googleId
  let user = await User.findOne({ googleId: googleUser.googleId });
  let isNewUser = false;

  if (user) {
    // Existing Google user — sync updated profile picture or name if missing
    let isUpdated = false;
    if (!user.name && googleUser.name) {
      user.name = googleUser.name;
      isUpdated = true;
    }
    if (!user.profilePicture && googleUser.profilePicture) {
      user.profilePicture = googleUser.profilePicture;
      isUpdated = true;
    }
    if (isUpdated) {
      await user.save();
    }
  } else {
    // 2. Try finding user by email (Account Linking for existing Email OTP users)
    user = await User.findOne({ email: normalizedEmail });

    if (user) {
      // Link Google identity to existing account
      user.googleId = googleUser.googleId;
      if (!user.name && googleUser.name) {
        user.name = googleUser.name;
      }
      if (!user.profilePicture && googleUser.profilePicture) {
        user.profilePicture = googleUser.profilePicture;
      }
      await user.save();
    } else {
      // 3. Brand new user via Google
      user = await User.create({
        email: normalizedEmail,
        googleId: googleUser.googleId,
        name: googleUser.name || null,
        profilePicture: googleUser.profilePicture || null,
        authProvider: 'google',
        role: 'user',
      });
      isNewUser = true;
    }
  }

  // Generate CodeAtlas JWT token
  const token = generateToken({ id: user._id, role: user.role });

  return {
    user: user.toSafeObject(),
    token,
    isNewUser,
  };
};

/**
 * Get a user by their ID.
 * @param {string} userId
 * @returns {Object} Safe user object.
 */
const getUserById = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  return user.toSafeObject();
};

module.exports = { requestOtp, verifyOtp, handleGoogleAuth, getUserById };
