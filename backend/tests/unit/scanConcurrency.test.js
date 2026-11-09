/**
 * Unit Tests: Scan Concurrency, Active Scan Reservation, and Startup Reconciliation
 * Migrated from backend/scratch/test_phase7a2b.js (Group 5) and test_phase7a2c.js (Groups 1 - 3).
 * Preserves all 14 original assertions.
 */

const mongoose = require('mongoose');
const Scan = require('../../src/models/Scan');
const Repository = require('../../src/models/Repository');
const githubService = require('../../src/services/githubService');
const scanExecutionService = require('../../src/services/scanExecutionService');
const { createScan, reconcileStrandedScans } = require('../../src/services/scanService');

describe('Scan Concurrency & Startup Recovery (Phase 7A.2B & 7A.2C)', () => {
  describe('Group 1: Scan Model Index & Field Definition', () => {
    test('Scan model declares activeScanKey field with default null', () => {
      const activeScanKeyPath = Scan.schema.path('activeScanKey');
      expect(activeScanKeyPath).toBeDefined();
      expect(activeScanKeyPath.instance).toBe('String');
    });

    test('Scan model declares partial unique index for activeScanKey lock', () => {
      const indexes = Scan.schema.indexes();
      const activeIndex = indexes.find(
        (idx) => idx[0].activeScanKey === 1 && idx[1]?.unique === true
      );

      expect(activeIndex).toBeDefined();
      expect(activeIndex[1].unique).toBe(true);
      expect(activeIndex[1].partialFilterExpression).toEqual({
        activeScanKey: { $type: 'string' },
      });
    });

    test('Scan model declares partial unique index on activeScanKey for string type', () => {
      const indexes = Scan.schema.indexes();
      const activeIndex = indexes.find(
        (idx) => idx[0].activeScanKey === 1 && idx[1]?.unique === true
      );
      expect(activeIndex[1].partialFilterExpression.activeScanKey).toEqual({ $type: 'string' });
    });

    test('toSafeObject() strips activeScanKey from returned object', () => {
      const scan = new Scan({
        repositoryId: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(),
        status: 'QUEUED',
        branch: 'main',
        activeScanKey: '1234567890abcdef',
      });
      const safeObj = scan.toSafeObject();
      expect(safeObj.activeScanKey).toBeUndefined();
      expect(safeObj.__v).toBeUndefined();
      expect(safeObj.status).toBe('QUEUED');
    });
  });

  describe('Group 2: Reservation Lifecycle Handling', () => {
    test('createScan assigns activeScanKey = repositoryId.toString()', async () => {
      const repoId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();

      const origRepoFindOne = Repository.findOne;
      const origScanFindOne = Scan.findOne;
      const origResolveSha = githubService.resolveCommitSha;
      const origScanCreate = Scan.create;
      const origExecute = scanExecutionService.executeScan;

      let createdPayload = null;

      Repository.findOne = jest.fn().mockResolvedValue({
        _id: repoId,
        owner: 'testowner',
        name: 'testrepo',
        defaultBranch: 'main',
      });
      Scan.findOne = jest.fn().mockResolvedValue(null);
      githubService.resolveCommitSha = jest.fn().mockResolvedValue('sha123456');
      scanExecutionService.executeScan = jest.fn().mockResolvedValue();
      Scan.create = jest.fn().mockImplementation(async (payload) => {
        createdPayload = payload;
        return {
          _id: new mongoose.Types.ObjectId(),
          ...payload,
          toSafeObject: () => payload,
        };
      });

      try {
        await createScan(userId, repoId.toString());
        expect(createdPayload).not.toBeNull();
        expect(createdPayload.activeScanKey).toBe(repoId.toString());
        expect(createdPayload.status).toBe('QUEUED');
      } finally {
        Repository.findOne = origRepoFindOne;
        Scan.findOne = origScanFindOne;
        githubService.resolveCommitSha = origResolveSha;
        Scan.create = origScanCreate;
        scanExecutionService.executeScan = origExecute;
      }
    });

    test('createScan handles duplicate-key error (code 11000) with HTTP 409', async () => {
      const repoId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();

      const origRepoFindOne = Repository.findOne;
      const origScanFindOne = Scan.findOne;
      const origResolveSha = githubService.resolveCommitSha;
      const origScanCreate = Scan.create;

      Repository.findOne = jest.fn().mockResolvedValue({
        _id: repoId,
        owner: 'testowner',
        name: 'testrepo',
        defaultBranch: 'main',
      });
      Scan.findOne = jest.fn().mockResolvedValue(null);
      githubService.resolveCommitSha = jest.fn().mockResolvedValue('abc123commitsha');
      Scan.create = jest.fn().mockImplementation(async () => {
        const err = new Error('E11000 duplicate key error collection: codeatlas.scans index: repositoryId_1');
        err.code = 11000;
        throw err;
      });

      try {
        let thrown = null;
        try {
          await createScan(userId, repoId.toString());
        } catch (err) {
          thrown = err;
        }

        expect(thrown).not.toBeNull();
        expect(thrown.statusCode).toBe(409);
        expect(thrown.code).toBe('SCAN_ALREADY_IN_PROGRESS');
        expect(thrown.message).toBe('A scan is already in progress for this repository.');
      } finally {
        Repository.findOne = origRepoFindOne;
        Scan.findOne = origScanFindOne;
        githubService.resolveCommitSha = origResolveSha;
        Scan.create = origScanCreate;
      }
    });

    test('createScan catches duplicate activeScanKey (11000) and returns HTTP 409', async () => {
      const repoId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();

      const origRepoFindOne = Repository.findOne;
      const origScanFindOne = Scan.findOne;
      const origResolveSha = githubService.resolveCommitSha;
      const origScanCreate = Scan.create;

      Repository.findOne = jest.fn().mockResolvedValue({
        _id: repoId,
        owner: 'testowner',
        name: 'testrepo',
        defaultBranch: 'main',
      });
      Scan.findOne = jest.fn().mockResolvedValue(null);
      githubService.resolveCommitSha = jest.fn().mockResolvedValue('sha123456');
      Scan.create = jest.fn().mockImplementation(async () => {
        const err = new Error('E11000 duplicate key error collection: codeatlas.scans index: activeScanKey_1');
        err.code = 11000;
        throw err;
      });

      try {
        let thrown = null;
        try {
          await createScan(userId, repoId.toString());
        } catch (err) {
          thrown = err;
        }

        expect(thrown).not.toBeNull();
        expect(thrown.statusCode).toBe(409);
        expect(thrown.code).toBe('SCAN_ALREADY_IN_PROGRESS');
        expect(thrown.message).toBe('A scan is already in progress for this repository.');
      } finally {
        Repository.findOne = origRepoFindOne;
        Scan.findOne = origScanFindOne;
        githubService.resolveCommitSha = origResolveSha;
        Scan.create = origScanCreate;
      }
    });
  });

  describe('Group 3: Startup Recovery Fail-Safe Behavior', () => {
    test('reconcileStrandedScans updates only QUEUED and RUNNING scans to FAILED', async () => {
      let capturedQuery = null;
      let capturedUpdate = null;

      const originalUpdateMany = Scan.updateMany;
      Scan.updateMany = jest.fn().mockImplementation(async (query, update) => {
        capturedQuery = query;
        capturedUpdate = update;
        return { modifiedCount: 3 };
      });

      try {
        const recoveredCount = await reconcileStrandedScans();
        expect(recoveredCount).toBe(3);
        expect(capturedQuery).toEqual({ status: { $in: ['QUEUED', 'RUNNING'] } });
        expect(capturedUpdate.$set.status).toBe('FAILED');
        expect(capturedUpdate.$set.completedAt instanceof Date).toBe(true);
        expect(capturedUpdate.$set.error).toBe(
          'Scan was interrupted by server restart. Please trigger a new scan.'
        );
      } finally {
        Scan.updateMany = originalUpdateMany;
      }
    });

    test('reconcileStrandedScans releases activeScanKey on recovered scans', async () => {
      let capturedQuery = null;
      let capturedUpdate = null;

      const originalUpdateMany = Scan.updateMany;
      Scan.updateMany = jest.fn().mockImplementation(async (query, update) => {
        capturedQuery = query;
        capturedUpdate = update;
        return { modifiedCount: 2 };
      });

      try {
        const count = await reconcileStrandedScans();
        expect(count).toBe(2);
        expect(capturedQuery).toEqual({ status: { $in: ['QUEUED', 'RUNNING'] } });
        expect(capturedUpdate.$set.status).toBe('FAILED');
        expect(capturedUpdate.$set.activeScanKey).toBeNull();
        expect(capturedUpdate.$set.completedAt instanceof Date).toBe(true);
      } finally {
        Scan.updateMany = originalUpdateMany;
      }
    });

    test('reconcileStrandedScans ignores COMPLETED and FAILED scans', async () => {
      let capturedQuery = null;
      const originalUpdateMany = Scan.updateMany;
      Scan.updateMany = jest.fn().mockImplementation(async (query) => {
        capturedQuery = query;
        return { modifiedCount: 0 };
      });

      try {
        await reconcileStrandedScans();
        expect(capturedQuery.status.$in).not.toContain('COMPLETED');
        expect(capturedQuery.status.$in).not.toContain('FAILED');
      } finally {
        Scan.updateMany = originalUpdateMany;
      }
    });

    test('reconcileStrandedScans handles zero stranded scans smoothly', async () => {
      const originalUpdateMany = Scan.updateMany;
      Scan.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 });

      try {
        const recoveredCount = await reconcileStrandedScans();
        expect(recoveredCount).toBe(0);
      } finally {
        Scan.updateMany = originalUpdateMany;
      }
    });

    test('reconcileStrandedScans rethrows database errors to fail startup safely', async () => {
      const originalUpdateMany = Scan.updateMany;
      Scan.updateMany = jest.fn().mockRejectedValue(new Error('Database connection failed'));

      try {
        await expect(reconcileStrandedScans()).rejects.toThrow('Database connection failed');
      } finally {
        Scan.updateMany = originalUpdateMany;
      }
    });

    test('reconcileStrandedScans rethrows database errors to fail server startup safely', async () => {
      const originalUpdateMany = Scan.updateMany;
      Scan.updateMany = jest.fn().mockRejectedValue(new Error('Database connection lost during recovery'));

      try {
        await expect(reconcileStrandedScans()).rejects.toThrow('Database connection lost during recovery');
      } finally {
        Scan.updateMany = originalUpdateMany;
      }
    });

    test('Historical COMPLETED and FAILED scans are excluded from reconciliation', async () => {
      let capturedQuery = null;
      const originalUpdateMany = Scan.updateMany;
      Scan.updateMany = jest.fn().mockImplementation(async (query) => {
        capturedQuery = query;
        return { modifiedCount: 0 };
      });

      try {
        await reconcileStrandedScans();
        expect(capturedQuery.status.$in).toEqual(['QUEUED', 'RUNNING']);
      } finally {
        Scan.updateMany = originalUpdateMany;
      }
    });
  });
});

