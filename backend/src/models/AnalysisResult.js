/**
 * AnalysisResult Model
 *
 * Stores the structured output of ONE analyzer execution associated with ONE Scan.
 * Relationship: User -> Repository -> Scan -> AnalysisResult (1:1 per Scan).
 *
 * Security contract:
 * - MUST NOT contain: environment variable values, OAuth tokens, JWT tokens,
 *   GitHub access tokens, secrets, or raw repository file contents.
 * - Environment variables are stored by NAME only (no values).
 *
 * Structural contract:
 * - Does NOT persist the raw files[] inventory.
 * - Does NOT duplicate repository identity fields (name, url, owner, etc.).
 * - Does NOT duplicate Scan lifecycle fields (status, startedAt, completedAt, error).
 */

const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/**
 * A single API endpoint fact extracted from source code or documentation.
 */
const apiEndpointSchema = new mongoose.Schema(
  {
    method: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    path: {
      type: String,
      required: true,
      trim: true,
    },
    file: {
      type: String,
      default: null,
    },
    line: {
      type: Number,
      default: null,
    },
  },
  { _id: false }
);

/**
 * A single environment variable fact.
 * NAME only — values MUST NOT be persisted.
 */
const envVarSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    file: {
      type: String,
      default: null,
    },
    line: {
      type: Number,
      default: null,
    },
  },
  { _id: false }
);

/**
 * A single dependency fact extracted from package manifests.
 */
const dependencySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    version: {
      type: String,
      default: null,
    },
    type: {
      type: String,
      enum: ['production', 'development', 'peer', 'optional', 'unknown'],
      default: 'unknown',
    },
  },
  { _id: false }
);

/**
 * A single npm script entry extracted from package manifests.
 */
const scriptSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    command: {
      type: String,
      default: null,
    },
  },
  { _id: false }
);

/**
 * Structured facts extracted from source code files.
 */
const codeFactsSchema = new mongoose.Schema(
  {
    apiEndpoints: {
      type: [apiEndpointSchema],
      default: [],
    },
    envVars: {
      type: [envVarSchema],
      default: [],
    },
    dependencies: {
      type: [dependencySchema],
      default: [],
    },
    scripts: {
      type: [scriptSchema],
      default: [],
    },
  },
  { _id: false }
);

/**
 * Structured facts extracted from documentation files (README, etc.).
 */
const documentationFactsSchema = new mongoose.Schema(
  {
    apiEndpoints: {
      type: [apiEndpointSchema],
      default: [],
    },
    envVars: {
      type: [envVarSchema],
      default: [],
    },
  },
  { _id: false }
);

/**
 * Evidence pointing to a location in source code.
 */
const codeEvidenceSchema = new mongoose.Schema(
  {
    file: { type: String, default: null },
    line: { type: Number, default: null },
    method: { type: String, default: null },
    path: { type: String, default: null },
    name: { type: String, default: null },
  },
  { _id: false }
);

/**
 * Evidence pointing to a location in documentation.
 */
const documentationEvidenceSchema = new mongoose.Schema(
  {
    file: { type: String, default: null },
    line: { type: Number, default: null },
    method: { type: String, default: null },
    path: { type: String, default: null },
    name: { type: String, default: null },
  },
  { _id: false }
);

/**
 * A single drift finding.
 * Types and severities mirror the analyzer findingFactory constants.
 */
const findingSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        'UNDOCUMENTED_API',
        'OBSOLETE_API_DOCUMENTATION',
        'UNDOCUMENTED_ENVIRONMENT_VARIABLE',
        'OBSOLETE_ENVIRONMENT_VARIABLE',
      ],
    },
    severity: {
      type: String,
      required: true,
      enum: ['HIGH', 'MEDIUM', 'LOW'],
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    resource: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    codeEvidence: {
      type: codeEvidenceSchema,
      default: null,
    },
    documentationEvidence: {
      type: documentationEvidenceSchema,
      default: null,
    },
  },
  { _id: false }
);

/**
 * Aggregate counts for drift findings.
 */
const driftSummarySchema = new mongoose.Schema(
  {
    total: { type: Number, required: true, min: 0, default: 0 },
    high: { type: Number, required: true, min: 0, default: 0 },
    medium: { type: Number, required: true, min: 0, default: 0 },
    low: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false }
);

/**
 * Complete drift detection result: summary + findings array.
 */
const driftSchema = new mongoose.Schema(
  {
    summary: {
      type: driftSummarySchema,
      required: true,
      default: () => ({ total: 0, high: 0, medium: 0, low: 0 }),
    },
    findings: {
      type: [findingSchema],
      default: [],
    },
  },
  { _id: false }
);

/**
 * File count breakdown by category.
 * Stored for summary display — NO file paths or file content.
 */
const fileCountsSchema = new mongoose.Schema(
  {
    total: { type: Number, min: 0, default: 0 },
    source: { type: Number, min: 0, default: 0 },
    documentation: { type: Number, min: 0, default: 0 },
    configuration: { type: Number, min: 0, default: 0 },
    infrastructure: { type: Number, min: 0, default: 0 },
    other: { type: Number, min: 0, default: 0 },
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// Root schema
// ---------------------------------------------------------------------------

const analysisResultSchema = new mongoose.Schema(
  {
    /**
     * The scan this result belongs to.
     * 1:1 enforced by unique index on scanId below.
     */
    scanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Scan',
      required: [true, 'Scan ID is required'],
    },

    /**
     * Denormalised for ownership isolation.
     * Allows result queries without joining through Scan.
     */
    repositoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Repository',
      required: [true, 'Repository ID is required'],
    },

    /**
     * Denormalised for ownership isolation.
     */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
    },

    /**
     * The git commit SHA that was scanned.
     * Preserved for result traceability and re-scan diffing.
     */
    commitSha: {
      type: String,
      default: null,
      trim: true,
    },

    /**
     * The branch that was scanned.
     */
    branch: {
      type: String,
      default: null,
      trim: true,
    },

    /**
     * Semantic version of the analyzer that produced this result.
     * Enables detection of stale results from outdated analyzer versions.
     */
    analyzerVersion: {
      type: String,
      required: [true, 'Analyzer version is required'],
      trim: true,
    },

    /**
     * File count statistics broken down by category.
     * Does NOT contain file paths or file content.
     */
    fileCounts: {
      type: fileCountsSchema,
      default: () => ({}),
    },

    /**
     * Structured facts extracted from the repository.
     * Code-side: apiEndpoints, envVars (names only), dependencies, scripts.
     * Documentation-side: apiEndpoints, envVars (names only).
     */
    facts: {
      code: {
        type: codeFactsSchema,
        default: () => ({}),
      },
      documentation: {
        type: documentationFactsSchema,
        default: () => ({}),
      },
    },

    /**
     * Drift detection output.
     * Contains summary counts and the individual findings array.
     */
    drift: {
      type: driftSchema,
      default: () => ({}),
    },

    /**
     * Important files detected in the repository (README, package.json, Dockerfile, etc.).
     * Stored as a structured object matching the analyzer's importantFiles output.
     * Does NOT contain file contents — names/paths only.
     */
    importantFiles: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    /**
     * Non-fatal warnings produced during analysis (e.g. fetch failures, parse errors).
     * Stored for diagnostics only — does not affect drift findings.
     */
    warnings: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

/**
 * 1:1 enforcement: one Scan may have at most one AnalysisResult.
 */
analysisResultSchema.index({ scanId: 1 }, { unique: true });

/**
 * Efficient listing of all results for a repository, newest-first.
 */
analysisResultSchema.index({ repositoryId: 1, createdAt: -1 });

/**
 * Efficient listing of all results for a user, newest-first.
 */
analysisResultSchema.index({ userId: 1, createdAt: -1 });

/**
 * Ownership isolation: validate that a result belongs to the requesting user.
 */
analysisResultSchema.index({ scanId: 1, userId: 1 });

// ---------------------------------------------------------------------------
// Instance methods
// ---------------------------------------------------------------------------

/**
 * Returns a safe, API-serialisable representation of this result.
 * Strips Mongoose internals (__v).
 */
analysisResultSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

const AnalysisResult = mongoose.model('AnalysisResult', analysisResultSchema);

module.exports = AnalysisResult;
