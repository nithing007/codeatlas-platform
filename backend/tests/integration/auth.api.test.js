/**
 * Integration Tests: Authentication API Contracts
 *
 * Verifies:
 * - Missing email on OTP request returns HTTP 400
 * - Invalid email format returns HTTP 400
 * - Successful OTP request returns HTTP 200
 * - Missing OTP fields on verification returns HTTP 400
 * - Invalid OTP returns HTTP 401
 * - Successful OTP verification returns HTTP 200, user, and sets HttpOnly cookie
 * - Missing authentication cookie on /api/auth/me returns HTTP 401
 * - Invalid session token on /api/auth/me returns HTTP 401
 * - Valid authenticated session on /api/auth/me returns HTTP 200 with user profile
 */

const request = require('supertest');
const app = require('../../src/app');
const Otp = require('../../src/models/Otp');
const bcrypt = require('bcryptjs');
const { connectTestDb, cleanTestDb, disconnectTestDb } = require('../helpers/testDb');
const { createAuthenticatedUser } = require('../helpers/authHelper');

describe('Authentication API Integration Tests (/api/auth)', () => {
  beforeAll(async () => {
    await connectTestDb();
  });

  afterAll(async () => {
    await cleanTestDb();
    await disconnectTestDb();
  });

  describe('POST /api/auth/request-otp', () => {
    test('returns 400 when email is missing', async () => {
      const res = await request(app)
        .post('/api/auth/request-otp')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/valid email/i);
    });

    test('returns 400 when email format is invalid', async () => {
      const res = await request(app)
        .post('/api/auth/request-otp')
        .send({ email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/valid email/i);
    });

    test('returns 200 and sends code when email is valid', async () => {
      const testEmail = 'valid-otp-req@codeatlas.test';
      const res = await request(app)
        .post('/api/auth/request-otp')
        .send({ email: testEmail });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/verification code sent/i);

      // Verify OTP document was persisted in test DB
      const record = await Otp.findOne({ email: testEmail });
      expect(record).not.toBeNull();
      expect(record.email).toBe(testEmail);
    });
  });

  describe('POST /api/auth/verify-otp', () => {
    test('returns 400 when email or OTP is missing', async () => {
      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ email: 'test@codeatlas.test' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/valid 6-digit verification code/i);
    });

    test('returns 401 when OTP is invalid or does not match', async () => {
      const email = 'invalid-code-check@codeatlas.test';
      const hashedOtp = await bcrypt.hash('123456', 10);
      await Otp.create({
        email,
        hashedOtp,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });

      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ email, otp: '999999' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/invalid.*code/i);
    });

    test('returns 200, creates user, and sets HttpOnly cookie on valid OTP', async () => {
      const email = 'success-otp-check@codeatlas.test';
      const plaintextOtp = '654321';
      const hashedOtp = await bcrypt.hash(plaintextOtp, 10);
      await Otp.create({
        email,
        hashedOtp,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });

      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ email, otp: plaintextOtp });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(email);

      // Verify HttpOnly cookie was set
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const authCookie = cookies.find((c) => c.startsWith('codeatlas_auth='));
      expect(authCookie).toBeDefined();
      expect(authCookie).toMatch(/HttpOnly/i);
    });
  });

  describe('GET /api/auth/me', () => {
    test('returns 401 when authentication cookie is missing', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/authentication required/i);
    });

    test('returns 401 when session token is invalid or corrupted', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', 'codeatlas_auth=corrupted.jwt.token');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/invalid or expired/i);
    });

    test('returns 200 and user profile when session is authenticated', async () => {
      const { user, cookie } = await createAuthenticatedUser({
        name: 'Jane Developer',
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toBeDefined();
      expect(res.body.user._id).toBe(user._id.toString());
      expect(res.body.user.email).toBe(user.email);
      expect(res.body.user.name).toBe('Jane Developer');
    });
  });
});
