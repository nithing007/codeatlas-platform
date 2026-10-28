/**
 * Repository Model
 * Represents a GitHub repository imported into CodeAtlas for analysis.
 */

const mongoose = require('mongoose');

const repositorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    githubRepositoryId: {
      type: String,
      required: [true, 'GitHub Repository ID is required'],
    },
    name: {
      type: String,
      required: [true, 'Repository name is required'],
      trim: true,
    },
    fullName: {
      type: String,
      required: [true, 'Repository full name (owner/repo) is required'],
      trim: true,
    },
    owner: {
      type: String,
      required: [true, 'Repository owner is required'],
      trim: true,
    },
    description: {
      type: String,
      default: null,
    },
    url: {
      type: String,
      default: null,
    },
    htmlUrl: {
      type: String,
      required: [true, 'Repository HTML URL is required'],
      trim: true,
    },
    defaultBranch: {
      type: String,
      default: 'main',
    },
    private: {
      type: Boolean,
      default: false,
    },
    visibility: {
      type: String,
      default: 'public',
    },
    language: {
      type: String,
      default: null,
    },
    stars: {
      type: Number,
      default: 0,
    },
    forks: {
      type: Number,
      default: 0,
    },
    openIssues: {
      type: Number,
      default: 0,
    },
    size: {
      type: Number,
      default: 0,
    },
    lastScannedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Prevent a single user from importing the same repository twice
repositorySchema.index({ userId: 1, fullName: 1 }, { unique: true });

// Optimize query for listing user's repositories ordered by most recent
repositorySchema.index({ userId: 1, createdAt: -1 });

const Repository = mongoose.model('Repository', repositorySchema);

module.exports = Repository;
