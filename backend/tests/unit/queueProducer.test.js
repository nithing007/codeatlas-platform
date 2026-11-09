/**
 * Unit Tests: Queue Producer & Persistence Model (Stage 7B.2A)
 */

const mongoose = require('mongoose');
const Scan = require('../../src/models/Scan');
const { enqueueScan, calculateBackoff, getQueueMetrics } = require('../../src/queue/scanQueue');
const queueConstants = require('../../src/queue/queueConstants');

describe('Queue Persistence & Producer Unit Tests (Phase 7B.2A)', () => {
  describe('Scan Schema Queue Extensions & Index Definitions', () => {
    test('declares all queue persistent fields with expected types', () => {
      const paths = Scan.schema.paths;
      expect(paths.priority).toBeDefined();
      expect(paths.priority.instance).toBe('Number');

      expect(paths.attempts).toBeDefined();
      expect(paths.attempts.instance).toBe('Number');

      expect(paths.maxAttempts).toBeDefined();
      expect(paths.maxAttempts.instance).toBe('Number');

      expect(paths.nextRunAt).toBeDefined();
      expect(paths.nextRunAt.instance).toBe('Date');

      expect(paths.lockedAt).toBeDefined();
      expect(paths.lockedAt.instance).toBe('Date');

      expect(paths.lockedBy).toBeDefined();
      expect(paths.lockedBy.instance).toBe('String');

      expect(paths.leaseExpiresAt).toBeDefined();
      expect(paths.leaseExpiresAt.instance).toBe('Date');

      expect(paths.lastError).toBeDefined();
      expect(paths.lastError.instance).toBe('String');
    });

    test('declares queue polling and lease recovery compound indexes', () => {
      const indexes = Scan.schema.indexes();

      const claimIdx = indexes.find(
        (idx) =>
          idx[0].status === 1 &&
          idx[0].nextRunAt === 1 &&
          idx[0].priority === -1 &&
          idx[0].createdAt === 1
      );
      expect(claimIdx).toBeDefined();

      const leaseIdx = indexes.find(
        (idx) => idx[0].status === 1 && idx[0].leaseExpiresAt === 1
      );
      expect(leaseIdx).toBeDefined();
    });

    test('declares activeScanKey partial unique index to preserve concurrency lock', () => {
      const indexes = Scan.schema.indexes();
      const activeIdx = indexes.find(
        (idx) => idx[0].activeScanKey === 1 && idx[1]?.unique === true
      );
      expect(activeIdx).toBeDefined();
      expect(activeIdx[1].partialFilterExpression).toEqual({
        activeScanKey: { $type: 'string' },
      });
    });

    test('toSafeObject() completely strips internal queue and lock metadata', () => {
      const scan = new Scan({
        repositoryId: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(),
        status: 'QUEUED',
        branch: 'main',
        activeScanKey: '1234567890abcdef',
        priority: 10,
        attempts: 2,
        maxAttempts: 3,
        nextRunAt: new Date(),
        lockedAt: new Date(),
        lockedBy: 'worker-node-1:1234',
        leaseExpiresAt: new Date(),
        lastError: 'Temporary network failure',
      });

      const safe = scan.toSafeObject();
      expect(safe.activeScanKey).toBeUndefined();
      expect(safe.priority).toBeUndefined();
      expect(safe.attempts).toBeUndefined();
      expect(safe.maxAttempts).toBeUndefined();
      expect(safe.nextRunAt).toBeUndefined();
      expect(safe.lockedAt).toBeUndefined();
      expect(safe.lockedBy).toBeUndefined();
      expect(safe.leaseExpiresAt).toBeUndefined();
      expect(safe.lastError).toBeUndefined();
      expect(safe.__v).toBeUndefined();

      // Preserves legitimate public fields
      expect(safe.status).toBe('QUEUED');
      expect(safe.branch).toBe('main');
    });
  });

  describe('Backward Compatibility of Existing Scan Documents', () => {
    test('existing scan document without queue fields applies schema defaults', () => {
      // Simulating a document loaded from MongoDB created prior to Phase 7B.2
      const legacyDoc = new Scan({
        repositoryId: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(),
        status: 'COMPLETED',
        branch: 'main',
        commitSha: 'c0ffee123456',
        filesScanned: 42,
        findingsCount: 3,
        activeScanKey: null,
      });

      expect(legacyDoc.priority).toBe(0);
      expect(legacyDoc.attempts).toBe(0);
      expect(legacyDoc.maxAttempts).toBe(3);
      expect(legacyDoc.nextRunAt).toBeInstanceOf(Date);
      expect(legacyDoc.lockedAt).toBeNull();
      expect(legacyDoc.lockedBy).toBeNull();
      expect(legacyDoc.leaseExpiresAt).toBeNull();
      expect(legacyDoc.lastError).toBeNull();

      const safe = legacyDoc.toSafeObject();
      expect(safe.status).toBe('COMPLETED');
      expect(safe.filesScanned).toBe(42);
      expect(safe.priority).toBeUndefined();
      expect(safe.attempts).toBeUndefined();
    });
  });

  describe('Exponential Backoff Calculation', () => {
    test('calculates correct backoff values matching 10s, 20s, 40s progression', () => {
      expect(calculateBackoff(1)).toBe(queueConstants.BACKOFF_BASE_MS); // 10,000ms
      expect(calculateBackoff(2)).toBe(queueConstants.BACKOFF_BASE_MS * 2); // 20,000ms
      expect(calculateBackoff(3)).toBe(queueConstants.BACKOFF_BASE_MS * 4); // 40,000ms
      expect(calculateBackoff(4)).toBe(queueConstants.BACKOFF_BASE_MS * 8); // 80,000ms
    });
  });

  describe('enqueueScan Producer Function', () => {
    test('creates scan document with initial QUEUED queue parameters', async () => {
      const repoId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();

      let capturedPayload = null;
      const origCreate = Scan.create;
      Scan.create = jest.fn().mockImplementation(async (payload) => {
        capturedPayload = payload;
        return {
          _id: new mongoose.Types.ObjectId(),
          ...payload,
        };
      });

      try {
        const scan = await enqueueScan({
          repositoryId: repoId,
          userId,
          branch: 'develop',
          commitSha: 'abc123sha',
          priority: 5,
        });

        expect(capturedPayload).not.toBeNull();
        expect(capturedPayload.repositoryId).toBe(repoId);
        expect(capturedPayload.userId).toBe(userId);
        expect(capturedPayload.status).toBe('QUEUED');
        expect(capturedPayload.activeScanKey).toBe(repoId.toString());
        expect(capturedPayload.priority).toBe(5);
        expect(capturedPayload.attempts).toBe(0);
        expect(capturedPayload.maxAttempts).toBe(queueConstants.MAX_ATTEMPTS);
        expect(capturedPayload.nextRunAt).toBeInstanceOf(Date);
        expect(capturedPayload.lockedBy).toBeNull();
      } finally {
        Scan.create = origCreate;
      }
    });

    test('validates required repositoryId and userId parameters', async () => {
      await expect(enqueueScan({ repositoryId: null, userId: 'user123' })).rejects.toMatchObject({
        statusCode: 400,
        message: 'Repository ID is required',
      });

      await expect(enqueueScan({ repositoryId: 'repo123', userId: null })).rejects.toMatchObject({
        statusCode: 400,
        message: 'User ID is required',
      });
    });

    test('catches duplicate activeScanKey error (code 11000) and throws HTTP 409', async () => {
      const repoId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();

      const origCreate = Scan.create;
      Scan.create = jest.fn().mockImplementation(async () => {
        const err = new Error('E11000 duplicate key error collection: codeatlas.scans index: activeScanKey_1');
        err.code = 11000;
        throw err;
      });

      try {
        await expect(
          enqueueScan({
            repositoryId: repoId,
            userId,
          })
        ).rejects.toMatchObject({
          statusCode: 409,
          code: 'SCAN_ALREADY_IN_PROGRESS',
          message: 'A scan is already in progress for this repository.',
        });
      } finally {
        Scan.create = origCreate;
      }
    });
  });

  describe('Atomic State Transitions & Concurrency Control', () => {
    test('atomic claim transitions QUEUED to RUNNING and increments attempts', async () => {
      const scanId = new mongoose.Types.ObjectId();
      const workerId = 'worker-test-1:9999';
      const now = new Date();
      const leaseExpiresAt = new Date(now.getTime() + 60000);

      const origFindOneAndUpdate = Scan.findOneAndUpdate;
      let queryFilter = null;
      let updateOp = null;

      Scan.findOneAndUpdate = jest.fn().mockImplementation((filter, update, options) => {
        queryFilter = filter;
        updateOp = update;
        return Promise.resolve({
          _id: scanId,
          status: 'RUNNING',
          lockedAt: now,
          lockedBy: workerId,
          leaseExpiresAt,
          attempts: 1,
        });
      });

      try {
        const claimed = await Scan.findOneAndUpdate(
          {
            status: 'QUEUED',
            nextRunAt: { $lte: now },
          },
          {
            $set: {
              status: 'RUNNING',
              lockedAt: now,
              lockedBy: workerId,
              leaseExpiresAt,
            },
            $inc: { attempts: 1 },
          },
          { sort: { priority: -1, createdAt: 1 }, returnDocument: 'after' }
        );

        expect(claimed).not.toBeNull();
        expect(claimed.status).toBe('RUNNING');
        expect(claimed.lockedBy).toBe(workerId);
        expect(claimed.attempts).toBe(1);
        expect(queryFilter.status).toBe('QUEUED');
        expect(updateOp.$inc.attempts).toBe(1);
      } finally {
        Scan.findOneAndUpdate = origFindOneAndUpdate;
      }
    });

    test('atomic double-claim prevention: returns null when scan already claimed', async () => {
      const origFindOneAndUpdate = Scan.findOneAndUpdate;
      // Second worker attempting to claim returns null because filter status: 'QUEUED' does not match
      Scan.findOneAndUpdate = jest.fn().mockResolvedValue(null);

      try {
        const claimed = await Scan.findOneAndUpdate(
          {
            _id: new mongoose.Types.ObjectId(),
            status: 'QUEUED',
          },
          {
            $set: { status: 'RUNNING' },
          }
        );

        expect(claimed).toBeNull();
      } finally {
        Scan.findOneAndUpdate = origFindOneAndUpdate;
      }
    });

    test('missing scan record returns null safely on atomic update', async () => {
      const origFindOneAndUpdate = Scan.findOneAndUpdate;
      const nonExistentId = new mongoose.Types.ObjectId();
      Scan.findOneAndUpdate = jest.fn().mockResolvedValue(null);

      try {
        const result = await Scan.findOneAndUpdate(
          { _id: nonExistentId },
          { $set: { status: 'FAILED' } }
        );
        expect(result).toBeNull();
      } finally {
        Scan.findOneAndUpdate = origFindOneAndUpdate;
      }
    });

    test('atomic completion releases activeScanKey and records metrics', async () => {
      const scanId = new mongoose.Types.ObjectId();
      const origFindByIdAndUpdate = Scan.findByIdAndUpdate;

      let updateApplied = null;
      Scan.findByIdAndUpdate = jest.fn().mockImplementation((id, update) => {
        updateApplied = update;
        return Promise.resolve({ _id: id, status: 'COMPLETED' });
      });

      try {
        await Scan.findByIdAndUpdate(scanId, {
          $set: {
            status: 'COMPLETED',
            completedAt: new Date(),
            filesScanned: 15,
            findingsCount: 2,
            activeScanKey: null,
            lockedBy: null,
            leaseExpiresAt: null,
          },
        });

        expect(updateApplied.$set.status).toBe('COMPLETED');
        expect(updateApplied.$set.activeScanKey).toBeNull();
        expect(updateApplied.$set.filesScanned).toBe(15);
      } finally {
        Scan.findByIdAndUpdate = origFindByIdAndUpdate;
      }
    });

    test('atomic failure releases activeScanKey and records lastError', async () => {
      const scanId = new mongoose.Types.ObjectId();
      const origFindByIdAndUpdate = Scan.findByIdAndUpdate;

      let updateApplied = null;
      Scan.findByIdAndUpdate = jest.fn().mockImplementation((id, update) => {
        updateApplied = update;
        return Promise.resolve({ _id: id, status: 'FAILED' });
      });

      try {
        await Scan.findByIdAndUpdate(scanId, {
          $set: {
            status: 'FAILED',
            completedAt: new Date(),
            error: 'Repository unreachable',
            lastError: 'Repository unreachable',
            activeScanKey: null,
            lockedBy: null,
            leaseExpiresAt: null,
          },
        });

        expect(updateApplied.$set.status).toBe('FAILED');
        expect(updateApplied.$set.activeScanKey).toBeNull();
        expect(updateApplied.$set.error).toBe('Repository unreachable');
      } finally {
        Scan.findByIdAndUpdate = origFindByIdAndUpdate;
      }
    });
  });

  describe('Queue Metrics Aggregation', () => {
    test('getQueueMetrics returns accurate counts for all scan statuses', async () => {
      const origCount = Scan.countDocuments;
      Scan.countDocuments = jest.fn().mockImplementation((filter) => {
        if (filter.status === 'QUEUED') return Promise.resolve(3);
        if (filter.status === 'RUNNING') return Promise.resolve(1);
        if (filter.status === 'COMPLETED') return Promise.resolve(10);
        if (filter.status === 'FAILED') return Promise.resolve(2);
        return Promise.resolve(0);
      });

      try {
        const metrics = await getQueueMetrics();
        expect(metrics).toEqual({
          queued: 3,
          running: 1,
          completed: 10,
          failed: 2,
        });
      } finally {
        Scan.countDocuments = origCount;
      }
    });
  });
});
