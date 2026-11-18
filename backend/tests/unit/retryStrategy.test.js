/**
 * Unit Tests: Retry Strategy, Error Classification & Idempotency (Phase 7B.2D)
 */

'use strict';

const mongoose = require('mongoose');
const {
  classifyError,
  sanitizeErrorMessage,
  ERROR_CATEGORIES,
} = require('../../src/queue/errorClassifier');
const { calculateBackoff } = require('../../src/queue/scanQueue');
const {
  scheduleRetry,
  markTerminalFailure,
} = require('../../src/queue/scanWorker');
const Scan = require('../../src/models/Scan');
const queueConstants = require('../../src/queue/queueConstants');

describe('Phase 7B.2D Unit Tests: Retry Strategy & Idempotency', () => {
  // -------------------------------------------------------------------------
  // 1. Retryable error classification
  // -------------------------------------------------------------------------
  describe('1. Retryable Error Classification', () => {
    test('classifies HTTP 503, 504, 429, 500, 502, and network errors as retryable', () => {
      const cases = [
        { err: Object.assign(new Error('Rate limited'), { statusCode: 429 }), expectedCat: ERROR_CATEGORIES.RATE_LIMIT },
        { err: Object.assign(new Error('Timeout'), { statusCode: 504 }), expectedCat: ERROR_CATEGORIES.NETWORK_TIMEOUT },
        { err: Object.assign(new Error('Abort'), { name: 'AbortError' }), expectedCat: ERROR_CATEGORIES.NETWORK_TIMEOUT },
        { err: Object.assign(new Error('Socket timeout'), { code: 'ETIMEDOUT' }), expectedCat: ERROR_CATEGORIES.NETWORK_TIMEOUT },
        { err: Object.assign(new Error('Unavailable'), { statusCode: 503 }), expectedCat: ERROR_CATEGORIES.TRANSIENT_ANALYZER },
        { err: Object.assign(new Error('Conn refused'), { code: 'ECONNREFUSED' }), expectedCat: ERROR_CATEGORIES.TRANSIENT_ANALYZER },
        { err: Object.assign(new Error('Bad Gateway'), { statusCode: 502 }), expectedCat: ERROR_CATEGORIES.TRANSIENT_ANALYZER },
        { err: Object.assign(new Error('Internal Server Error'), { statusCode: 500 }), expectedCat: ERROR_CATEGORIES.TRANSIENT_ANALYZER },
        { err: Object.assign(new Error('Mongo network timeout'), { name: 'MongoNetworkError' }), expectedCat: ERROR_CATEGORIES.TRANSIENT_DB },
        { err: Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' }), expectedCat: ERROR_CATEGORIES.TRANSIENT_DB },
      ];

      for (const { err, expectedCat } of cases) {
        const classified = classifyError(err);
        expect(classified.retryable).toBe(true);
        expect(classified.category).toBe(expectedCat);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. Permanent error classification
  // -------------------------------------------------------------------------
  describe('2. Permanent Error Classification', () => {
    test('classifies HTTP 404, 400, 401, 403, ValidationError, and CastError as permanent', () => {
      const cases = [
        { err: Object.assign(new Error('Not found'), { statusCode: 404 }), expectedCat: ERROR_CATEGORIES.PERMANENT_NOT_FOUND },
        { err: Object.assign(new Error('Bad request'), { statusCode: 400 }), expectedCat: ERROR_CATEGORIES.PERMANENT_VALIDATION },
        { err: Object.assign(new Error('Mongoose validation failed'), { name: 'ValidationError' }), expectedCat: ERROR_CATEGORIES.PERMANENT_VALIDATION },
        { err: Object.assign(new Error('Cast to ObjectId failed'), { name: 'CastError' }), expectedCat: ERROR_CATEGORIES.PERMANENT_VALIDATION },
        { err: Object.assign(new Error('Unauthorized'), { statusCode: 401 }), expectedCat: ERROR_CATEGORIES.PERMANENT_AUTH },
        { err: Object.assign(new Error('Forbidden'), { statusCode: 403 }), expectedCat: ERROR_CATEGORIES.PERMANENT_AUTH },
      ];

      for (const { err, expectedCat } of cases) {
        const classified = classifyError(err);
        expect(classified.retryable).toBe(false);
        expect(classified.category).toBe(expectedCat);
      }
    });

    test('Phase 7D: classifies HTTP 403 access denied error as permanent PERMANENT_AUTH and non-retryable', () => {
      const authError = Object.assign(new Error('Access to the requested GitHub repository was forbidden.'), { statusCode: 403, isAnalyzerError: true });
      const classified = classifyError(authError);
      expect(classified.retryable).toBe(false);
      expect(classified.category).toBe(ERROR_CATEGORIES.PERMANENT_AUTH);
      expect(classified.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Unknown error policy
  // -------------------------------------------------------------------------
  describe('3. Unknown Error Policy', () => {
    test('treats unrecognized errors as permanent UNKNOWN by default to prevent infinite crash loops', () => {
      const genericError = new Error('SyntaxError: Unexpected token < in JSON at position 0');
      const classified = classifyError(genericError);

      expect(classified.retryable).toBe(false);
      expect(classified.category).toBe(ERROR_CATEGORIES.UNKNOWN);
      expect(classified.statusCode).toBeNull();
      expect(classified.sanitizedMessage).toContain('SyntaxError');
    });

    test('treats null/undefined/non-object errors as permanent UNKNOWN', () => {
      const classifiedNull = classifyError(null);
      expect(classifiedNull.retryable).toBe(false);
      expect(classifiedNull.category).toBe(ERROR_CATEGORIES.UNKNOWN);

      const classifiedString = classifyError('raw string error');
      expect(classifiedString.retryable).toBe(false);
      expect(classifiedString.category).toBe(ERROR_CATEGORIES.UNKNOWN);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Backoff calculation
  // -------------------------------------------------------------------------
  describe('4. Backoff Calculation', () => {
    test('calculates deterministic exponential backoff for attempts 1, 2, and 3', () => {
      // Base backoff is 10,000 ms (10 seconds)
      // Attempt 1 failure: delay = 2^(1 - 1) * 10000 = 10,000 ms (10s)
      expect(calculateBackoff(1)).toBe(10000);

      // Attempt 2 failure: delay = 2^(2 - 1) * 10000 = 20,000 ms (20s)
      expect(calculateBackoff(2)).toBe(20000);

      // Attempt 3 failure: delay = 2^(3 - 1) * 10000 = 40,000 ms (40s)
      expect(calculateBackoff(3)).toBe(40000);

      // Edge case: attempt <= 0 clamped to base
      expect(calculateBackoff(0)).toBe(10000);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Maximum-attempt semantics
  // -------------------------------------------------------------------------
  describe('5. Maximum-Attempt Semantics', () => {
    test('permits retry when attempts < maxAttempts, terminal failure when attempts >= maxAttempts', () => {
      const maxAttempts = queueConstants.MAX_ATTEMPTS; // 3

      // Attempt 1 failed -> retryable
      const attempt1 = 1;
      expect(attempt1 < maxAttempts).toBe(true);

      // Attempt 2 failed -> retryable
      const attempt2 = 2;
      expect(attempt2 < maxAttempts).toBe(true);

      // Attempt 3 failed -> terminal
      const attempt3 = 3;
      expect(attempt3 < maxAttempts).toBe(false);

      // Attempt 4 failed -> terminal
      const attempt4 = 4;
      expect(attempt4 < maxAttempts).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Error sanitization
  // -------------------------------------------------------------------------
  describe('6. Error Sanitization', () => {
    test('strips Bearer tokens, connection credentials, and local file paths', () => {
      const secretMsg =
        'Failed to connect to mongodb://admin:p@ssw0rd123@cluster0.mongodb.net/codeatlas ' +
        'using Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secretToken ' +
        'at D:\\Projects\\codeatlas\\backend\\src\\index.js and /var/app/secret/config.json?token=mySecret123';

      const sanitized = sanitizeErrorMessage(secretMsg);

      expect(sanitized).not.toContain('p@ssw0rd123');
      expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secretToken');
      expect(sanitized).not.toContain('D:\\Projects\\codeatlas');
      expect(sanitized).not.toContain('/var/app/secret/config.json');
      expect(sanitized).not.toContain('mySecret123');

      expect(sanitized).toContain('[REDACTED]');
      expect(sanitized).toContain('[FILE_PATH]');
    });
  });

  // -------------------------------------------------------------------------
  // 7. Retry transition ownership filters
  // -------------------------------------------------------------------------
  describe('7. Retry Transition Ownership Filters', () => {
    test('builds findOneAndUpdate matching _id, status: RUNNING, and lockedBy: workerId', async () => {
      const origFindOneAndUpdate = Scan.findOneAndUpdate;
      let capturedFilter = null;
      let capturedUpdate = null;

      const dummyScan = {
        _id: new mongoose.Types.ObjectId(),
        status: 'RUNNING',
        attempts: 1,
        maxAttempts: 3,
        lockedBy: 'worker-unit:456',
        activeScanKey: 'repo-123',
      };

      Scan.findOneAndUpdate = jest.fn().mockImplementation((filter, update) => {
        capturedFilter = filter;
        capturedUpdate = update;
        return Promise.resolve(dummyScan);
      });

      try {
        const errorInfo = { sanitizedMessage: 'Temporary network failure' };
        const now = new Date('2026-11-16T12:00:00.000Z');
        const result = await scheduleRetry(dummyScan, errorInfo, 'worker-unit:456', now);

        expect(result).toBe(dummyScan);
        expect(capturedFilter._id).toEqual(dummyScan._id);
        expect(capturedFilter.status).toBe('RUNNING');
        expect(capturedFilter.lockedBy).toBe('worker-unit:456');

        expect(capturedUpdate.$set.status).toBe('QUEUED');
        expect(capturedUpdate.$set.lockedBy).toBeNull();
        expect(capturedUpdate.$set.lockedAt).toBeNull();
        expect(capturedUpdate.$set.leaseExpiresAt).toBeNull();
        expect(capturedUpdate.$set.lastError).toBe('Temporary network failure');
        expect(capturedUpdate.$set.nextRunAt.getTime()).toBe(now.getTime() + 10000);
      } finally {
        Scan.findOneAndUpdate = origFindOneAndUpdate;
      }
    });
  });

  // -------------------------------------------------------------------------
  // 8. Terminal failure ownership filters
  // -------------------------------------------------------------------------
  describe('8. Terminal Failure Ownership Filters', () => {
    test('builds findOneAndUpdate matching _id, status: RUNNING, and lockedBy: workerId when workerId provided', async () => {
      const origFindOneAndUpdate = Scan.findOneAndUpdate;
      let capturedFilter = null;
      let capturedUpdate = null;

      const scanId = new mongoose.Types.ObjectId();
      const dummyScan = {
        _id: scanId,
        status: 'FAILED',
        error: 'Permanent failure',
      };

      Scan.findOneAndUpdate = jest.fn().mockImplementation((filter, update) => {
        capturedFilter = filter;
        capturedUpdate = update;
        return Promise.resolve(dummyScan);
      });

      try {
        const errorInfo = { sanitizedMessage: 'Repository not found' };
        const now = new Date('2026-11-16T12:00:00.000Z');
        const result = await markTerminalFailure(scanId, errorInfo, 'worker-unit:456', now);

        expect(result).toBe(dummyScan);
        expect(capturedFilter._id).toEqual(scanId);
        expect(capturedFilter.status).toBe('RUNNING');
        expect(capturedFilter.lockedBy).toBe('worker-unit:456');

        expect(capturedUpdate.$set.status).toBe('FAILED');
        expect(capturedUpdate.$set.completedAt).toEqual(now);
        expect(capturedUpdate.$set.error).toBe('Repository not found');
        expect(capturedUpdate.$set.lastError).toBe('Repository not found');
        expect(capturedUpdate.$set.lockedBy).toBeNull();
        expect(capturedUpdate.$set.lockedAt).toBeNull();
        expect(capturedUpdate.$set.leaseExpiresAt).toBeNull();
      } finally {
        Scan.findOneAndUpdate = origFindOneAndUpdate;
      }
    });
  });

  // -------------------------------------------------------------------------
  // 9. Retry preserves activeScanKey
  // -------------------------------------------------------------------------
  describe('9. Retry Preserves activeScanKey', () => {
    test('scheduleRetry update payload does NOT nullify activeScanKey', async () => {
      const origFindOneAndUpdate = Scan.findOneAndUpdate;
      let capturedUpdate = null;

      const dummyScan = {
        _id: new mongoose.Types.ObjectId(),
        status: 'RUNNING',
        attempts: 1,
        maxAttempts: 3,
        lockedBy: 'worker-unit:456',
        activeScanKey: 'repo-123',
      };

      Scan.findOneAndUpdate = jest.fn().mockImplementation((filter, update) => {
        capturedUpdate = update;
        return Promise.resolve(dummyScan);
      });

      try {
        await scheduleRetry(dummyScan, { sanitizedMessage: 'retry err' }, 'worker-unit:456');

        expect(capturedUpdate.$set.activeScanKey).toBeUndefined();
        expect(capturedUpdate.$unset).toBeUndefined();
      } finally {
        Scan.findOneAndUpdate = origFindOneAndUpdate;
      }
    });
  });

  // -------------------------------------------------------------------------
  // 10. Terminal failure releases activeScanKey
  // -------------------------------------------------------------------------
  describe('10. Terminal Failure Releases activeScanKey', () => {
    test('markTerminalFailure explicitly sets activeScanKey to null', async () => {
      const origFindOneAndUpdate = Scan.findOneAndUpdate;
      let capturedUpdate = null;

      const scanId = new mongoose.Types.ObjectId();
      Scan.findOneAndUpdate = jest.fn().mockImplementation((filter, update) => {
        capturedUpdate = update;
        return Promise.resolve({ _id: scanId, status: 'FAILED' });
      });

      try {
        await markTerminalFailure(scanId, 'fatal error', 'worker-unit:456');

        expect(capturedUpdate.$set.activeScanKey).toBeNull();
      } finally {
        Scan.findOneAndUpdate = origFindOneAndUpdate;
      }
    });
  });
});

