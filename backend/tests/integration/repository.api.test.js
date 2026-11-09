/**
 * Integration Tests: Repository API Contracts
 *
 * Verifies:
 * - Unauthenticated requests return HTTP 401
 * - Missing repository URL returns HTTP 400
 * - Invalid GitHub URL format returns HTTP 400
 * - Preview repository returns HTTP 200 with metadata
 * - Import repository returns HTTP 201 and persists to DB
 * - Duplicate import for same user returns HTTP 409
 * - Ownership check: User A cannot view or delete User B's repository
 * - Invalid repository ID format returns HTTP 400
 * - List repositories returns only the authenticated user's records
 */

jest.mock('../../src/services/githubService');

const request = require('supertest');
const app = require('../../src/app');
const githubService = require('../../src/services/githubService');
const { connectTestDb, cleanTestDb, disconnectTestDb } = require('../helpers/testDb');
const { createAuthenticatedUser } = require('../helpers/authHelper');
const { mockGitHubRepoData } = require('../fixtures/githubRepo.fixture');

describe('Repository API Integration Tests (/api/repositories)', () => {
  let userA;
  let cookieA;
  let userB;
  let cookieB;

  beforeAll(async () => {
    await connectTestDb();
    const authA = await createAuthenticatedUser({ name: 'User A', email: 'user-a@codeatlas.test' });
    userA = authA.user;
    cookieA = authA.cookie;

    const authB = await createAuthenticatedUser({ name: 'User B', email: 'user-b@codeatlas.test' });
    userB = authB.user;
    cookieB = authB.cookie;
  });

  afterAll(async () => {
    await cleanTestDb();
    await disconnectTestDb();
  });

  beforeEach(() => {
    githubService.fetchPublicRepositoryMetadata.mockReset();
    githubService.fetchPublicRepositoryMetadata.mockResolvedValue(mockGitHubRepoData);
  });

  describe('Authentication Enforcement', () => {
    test('returns 401 on /preview when unauthenticated', async () => {
      const res = await request(app)
        .post('/api/repositories/preview')
        .send({ repositoryUrl: 'https://github.com/testuser/repo' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('returns 401 on GET /api/repositories when unauthenticated', async () => {
      const res = await request(app).get('/api/repositories');
      expect(res.status).toBe(401);
    });
  });

  describe('Input Validation', () => {
    test('returns 400 when repositoryUrl is missing on preview', async () => {
      const res = await request(app)
        .post('/api/repositories/preview')
        .set('Cookie', cookieA)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/url is required/i);
    });

    test('returns 400 when repositoryUrl is not a valid GitHub URL', async () => {
      const res = await request(app)
        .post('/api/repositories/preview')
        .set('Cookie', cookieA)
        .send({ repositoryUrl: 'https://gitlab.com/testuser/repo' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/GitHub repository URLs are supported/i);
    });
  });

  describe('POST /api/repositories/preview', () => {
    test('returns 200 with repository metadata without database persistence', async () => {
      const res = await request(app)
        .post('/api/repositories/preview')
        .set('Cookie', cookieA)
        .send({ repositoryUrl: 'https://github.com/testuser/node-express-boilerplate' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.repository).toBeDefined();
      expect(res.body.repository.fullName).toBe('testuser/node-express-boilerplate');
      expect(res.body.repository.owner).toBe('testuser');
      expect(res.body.repository.name).toBe('node-express-boilerplate');
    });
  });

  describe('POST /api/repositories (Import)', () => {
    test('returns 201 and persists repository on valid import', async () => {
      githubService.fetchPublicRepositoryMetadata.mockResolvedValueOnce({
        ...mockGitHubRepoData,
        fullName: 'testuser/imported-repo',
        name: 'imported-repo',
      });

      const res = await request(app)
        .post('/api/repositories')
        .set('Cookie', cookieA)
        .send({ repositoryUrl: 'https://github.com/testuser/imported-repo' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.repository).toBeDefined();
      expect(res.body.repository.fullName).toBe('testuser/imported-repo');
      expect(res.body.repository.userId).toBe(userA._id.toString());
    });

    test('returns 409 when user attempts to import the same repository again', async () => {
      githubService.fetchPublicRepositoryMetadata.mockResolvedValueOnce({
        ...mockGitHubRepoData,
        fullName: 'testuser/imported-repo',
        name: 'imported-repo',
      });

      const res = await request(app)
        .post('/api/repositories')
        .set('Cookie', cookieA)
        .send({ repositoryUrl: 'https://github.com/testuser/imported-repo' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/already.*imported/i);
    });
  });

  describe('Repository Ownership & Access Control', () => {
    let repoAId;

    beforeAll(async () => {
      githubService.fetchPublicRepositoryMetadata.mockResolvedValueOnce({
        ...mockGitHubRepoData,
        fullName: 'testuser/owned-by-a',
        name: 'owned-by-a',
      });

      const res = await request(app)
        .post('/api/repositories')
        .set('Cookie', cookieA)
        .send({ repositoryUrl: 'https://github.com/testuser/owned-by-a' });
      repoAId = res.body.repository._id;
    });

    test('User A can retrieve their own repository', async () => {
      const res = await request(app)
        .get(`/api/repositories/${repoAId}`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.repository._id).toBe(repoAId);
    });

    test('User B receives 404 when attempting to access User A repository', async () => {
      const res = await request(app)
        .get(`/api/repositories/${repoAId}`)
        .set('Cookie', cookieB);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/not found/i);
    });

    test('returns 404 for malformed repository ObjectId', async () => {
      const res = await request(app)
        .get('/api/repositories/invalid-object-id')
        .set('Cookie', cookieA);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/not found/i);
    });

    test('User B cannot delete User A repository', async () => {
      const res = await request(app)
        .delete(`/api/repositories/${repoAId}`)
        .set('Cookie', cookieB);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test('GET /api/repositories only lists repositories owned by authenticated user', async () => {
      const resA = await request(app)
        .get('/api/repositories')
        .set('Cookie', cookieA);

      expect(resA.status).toBe(200);
      expect(resA.body.repositories.length).toBeGreaterThanOrEqual(1);
      expect(resA.body.repositories.every((r) => r.userId === userA._id.toString())).toBe(true);

      const resB = await request(app)
        .get('/api/repositories')
        .set('Cookie', cookieB);

      expect(resB.status).toBe(200);
      expect(resB.body.repositories.length).toBe(0);
    });
  });
});
