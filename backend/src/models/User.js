/**
 * User model
 * Represents an authenticated user in CodeAtlas.
 * No password field — authentication uses OTP or OAuth.
 */

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: null,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    profilePicture: {
      type: String,
      default: null,
    },
    authProvider: {
      type: String,
      enum: ['email', 'google'],
      default: 'email',
    },
    googleId: {
      type: String,
      default: null,
    },
    githubId: {
      type: String,
      default: null,
    },
    githubAccessToken: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      enum: ['user', 'admin', 'USER', 'ADMIN'],
      default: 'user',
    },
  },
  {
    timestamps: true,
  }
);

// Unique index on googleId only when googleId is a string (ignores null/undefined for Email OTP users)
userSchema.index(
  { googleId: 1 },
  {
    unique: true,
    partialFilterExpression: { googleId: { $type: 'string' } },
  }
);

/**
 * Returns a safe user object without sensitive fields.
 * Use this when sending user data in API responses.
 */
userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.githubAccessToken;
  delete obj.__v;
  return obj;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
