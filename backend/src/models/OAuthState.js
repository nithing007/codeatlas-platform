/**
 * OAuthState model
 * Temporarily stores cryptographically random state tokens to prevent OAuth CSRF attacks.
 * Automatically removed by MongoDB TTL index after expiration.
 */

const mongoose = require('mongoose');

const oAuthStateSchema = new mongoose.Schema({
  state: {
    type: String,
    required: true,
    unique: true,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Automatically remove expired state records via MongoDB TTL index
oAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const OAuthState = mongoose.model('OAuthState', oAuthStateSchema);

module.exports = OAuthState;
