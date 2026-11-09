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
    /**
     * Unique lock key for active scans.
     * Contains the repository ID string while status is QUEUED or RUNNING.
     * Set to null upon reaching terminal status (COMPLETED or FAILED).
     * Enforced by partial unique index below.
     */
    activeScanKey: {
      type: String,
      default: null,
    },
    // ---- Persistent Queue Fields (Phase 7B.2) ----
    priority: {
      type: Number,
      default: 0,
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      default: 3,
      min: 1,
    },
    nextRunAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lockedAt: {
      type: Date,
      default: null,
    },
    lockedBy: {
      type: String,
      default: null,
    },
    leaseExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastError: {
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

// Enforces exactly ONE active scan (QUEUED or RUNNING) per repository at the database level
scanSchema.index(
  { activeScanKey: 1 },
  {
    unique: true,
    partialFilterExpression: { activeScanKey: { $type: 'string' } },
  }
);

// Optimize queue polling for eligible jobs by status, schedule, priority, and creation order
scanSchema.index({ status: 1, nextRunAt: 1, priority: -1, createdAt: 1 });

// Optimize lease expiration / stalled job sweep
scanSchema.index({ status: 1, leaseExpiresAt: 1 });

/**
 * Returns a safe scan object for API responses.
 * Strips internal locking and queue metadata.
 */
scanSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.__v;
  delete obj.activeScanKey;
  delete obj.priority;
  delete obj.attempts;
  delete obj.maxAttempts;
  delete obj.nextRunAt;
  delete obj.lockedAt;
  delete obj.lockedBy;
  delete obj.leaseExpiresAt;
  delete obj.lastError;
  return obj;
};

const Scan = mongoose.model('Scan', scanSchema);

module.exports = Scan;
