/**
 * Scan Model
 * Represents a repository analysis job lifecycle in CodeAtlas.
 */

const mongoose = require('mongoose');

const SCAN_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'];

const scanSchema = new mongoose.Schema(
  {
    repositoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Repository',
      required: [true, 'Repository ID is required'],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: SCAN_STATUSES,
        message: '{VALUE} is not a valid scan status',
      },
      default: 'QUEUED',
      required: true,
      index: true,
    },
    branch: {
      type: String,
      default: 'main',
      trim: true,
    },
    commitSha: {
      type: String,
      default: null,
      trim: true,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    filesScanned: {
      type: Number,
      default: 0,
      min: 0,
    },
    findingsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    error: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Optimize queries for repository scan history ordered newest-first
scanSchema.index({ repositoryId: 1, createdAt: -1 });

// Optimize queries for user scan history
scanSchema.index({ userId: 1, createdAt: -1 });

// Compound index for repository ownership validation
scanSchema.index({ repositoryId: 1, userId: 1 });

/**
 * Returns a safe scan object for API responses.
 */
scanSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

const Scan = mongoose.model('Scan', scanSchema);

module.exports = Scan;
