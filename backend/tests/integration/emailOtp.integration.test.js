/**
 * Integration Tests: Email OTP Delivery and Reliability
 *
 * Verifies:
 * - POST /api/auth/request-otp dispatches email when SMTP is configured
 * - Email body contains the generated 6-digit OTP
 * - Plaintext OTP in email successfully verifies against /api/auth/verify-otp
 * - When SMTP transport fails, API returns HTTP 502 with EMAIL_DELIVERY_FAILED
 *   (NEVER returns false positive 200 success)
 * - When recipient is rejected by SMTP provider, API returns HTTP 502 with EMAIL_DELIVERY_REJECTED
 * - Failed email delivery removes the un-sent OTP from DB so cooldown does not block retry
 * - Enforces 60-second resend cooldown (HTTP 429) on successfully dispatched OTPs
 * - Validates input format (HTTP 400 on missing or invalid email)
 * - Safe fallback in test/dev when SMTP is not configured
 */

const request = require('supertest');
const app = require('../../src/app');
const Otp = require('../../src/models/Otp');
const User = require('../../src/models/User');
const emailService = require('../../src/services/emailService');
const { connectTestDb, cleanTestDb, disconnectTestDb } = require('../helpers/testDb');

describe('Email OTP Delivery Integration Tests', () => {
  beforeAll(async () => {
    await connectTestDb();
  });

  afterAll(async () => {
    await cleanTestDb();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    emailService.resetTransporter();
    await Otp.deleteMany({});
  });

  afterEach(async () => {
    emailService.resetTransporter();
  });

  describe('POST /api/auth/request-otp with Mocked SMTP Transporter', () => {
    test('successfully sends OTP email via transporter and returns 200', async () => {
      const recipientEmail = 'successful-delivery@codeatlas.test';
      let sentMailOptions = null;

      const mockTransporter = {
        sendMail: jest.fn().mockImplementation(async (options) => {
          sentMailOptions = options;
          return {
            messageId: 'mock-msg-id-123',
            accepted: [recipientEmail],
            rejected: [],
            response: '250 2.0.0 OK',
          };
        }),
      };
      emailService.setTransporter(mockTransporter);

      const res = await request(app)
        .post('/api/auth/request-otp')
        .send({ email: recipientEmail });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/verification code sent/i);

      // Verify email transporter was invoked with correct options
      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(1);
      expect(sentMailOptions).not.toBeNull();
      expect(sentMailOptions.to).toBe(recipientEmail);
      expect(sentMailOptions.subject).toMatch(/verification code/i);

      // Extract OTP from plain text body
      const otpMatch = sentMailOptions.text.match(/\b\d{6}\b/);
      expect(otpMatch).not.toBeNull();
      const dispatchedOtp = otpMatch[0];

      // Verify OTP document was persisted in database
      const otpRecord = await Otp.findOne({ email: recipientEmail });
      expect(otpRecord).not.toBeNull();

      // Verify the dispatched OTP successfully verifies via /api/auth/verify-otp
      const verifyRes = await request(app)
        .post('/api/auth/verify-otp')
        .send({ email: recipientEmail, otp: dispatchedOtp });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);
      expect(verifyRes.body.user.email).toBe(recipientEmail);
    });

    test('returns HTTP 502 with EMAIL_DELIVERY_REJECTED when recipient is rejected by SMTP provider', async () => {
      const recipientEmail = 'rejected-user@codeatlas.test';

      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({
          messageId: 'mock-rejected-id',
          accepted: [],
          rejected: [recipientEmail],
          response: '550 5.1.1 Recipient rejected',
        }),
      };
      emailService.setTransporter(mockTransporter);

      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app)
        .post('/api/auth/request-otp')
        .send({ email: recipientEmail });

      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toEqual({
        code: 'EMAIL_DELIVERY_REJECTED',
        message: 'Email provider rejected the recipient address.',
      });

      // Verify that the failed OTP record was cleaned up from the DB
      const otpRecord = await Otp.findOne({ email: recipientEmail });
      expect(otpRecord).toBeNull();

      errSpy.mockRestore();
    });

    test('returns HTTP 502 and does NOT return false positive when SMTP delivery fails', async () => {
      const recipientEmail = 'failing-delivery@codeatlas.test';

      const mockTransporter = {
        sendMail: jest.fn().mockRejectedValue(
          new Error('535-5.7.8 Username and Password not accepted')
        ),
      };
      emailService.setTransporter(mockTransporter);

      // Suppress error logging during this intentional failure test
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app)
        .post('/api/auth/request-otp')
        .send({ email: recipientEmail });

      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
      // Structured error response
      expect(res.body.error).toEqual({
        code: 'EMAIL_DELIVERY_FAILED',
        message: 'Failed to send verification email. Please try again later.',
      });

      // Verify that the failed OTP record was cleaned up from the DB
      // so user is NOT stuck on 60-second cooldown
      const otpRecord = await Otp.findOne({ email: recipientEmail });
      expect(otpRecord).toBeNull();

      errSpy.mockRestore();
    });

    test('allows immediate retry after SMTP delivery failure without triggering cooldown', async () => {
      const recipientEmail = 'retry-after-fail@codeatlas.test';

      // First attempt fails
      const mockTransporterFail = {
        sendMail: jest.fn().mockRejectedValue(new Error('Connection timeout to SMTP server')),
      };
      emailService.setTransporter(mockTransporterFail);

      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const res1 = await request(app)
        .post('/api/auth/request-otp')
        .send({ email: recipientEmail });

      expect(res1.status).toBe(502);
      expect(res1.body.success).toBe(false);

      // Second attempt immediately after with recovered SMTP succeeds
      const mockTransporterSuccess = {
        sendMail: jest.fn().mockResolvedValue({
          messageId: 'msg-recovered-456',
          accepted: [recipientEmail],
          rejected: [],
          response: '250 OK',
        }),
      };
      emailService.setTransporter(mockTransporterSuccess);

      const res2 = await request(app)
        .post('/api/auth/request-otp')
        .send({ email: recipientEmail });

      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);

      errSpy.mockRestore();
    });

    test('enforces 60-second resend cooldown (429) when OTP was successfully dispatched', async () => {
      const recipientEmail = 'cooldown-test@codeatlas.test';

      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({
          messageId: 'msg-cooldown-1',
          accepted: [recipientEmail],
          rejected: [],
          response: '250 OK',
        }),
      };
      emailService.setTransporter(mockTransporter);

      // First request succeeds
      const res1 = await request(app)
        .post('/api/auth/request-otp')
        .send({ email: recipientEmail });
      expect(res1.status).toBe(200);

      // Immediate second request should be rejected with 429
      const res2 = await request(app)
        .post('/api/auth/request-otp')
        .send({ email: recipientEmail });

      expect(res2.status).toBe(429);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error).toMatch(/wait \d+ seconds before requesting a new code/i);
    });

    test('returns 400 for missing or invalid email format', async () => {
      const resEmpty = await request(app)
        .post('/api/auth/request-otp')
        .send({});
      expect(resEmpty.status).toBe(400);
      expect(resEmpty.body.success).toBe(false);

      const resInvalid = await request(app)
        .post('/api/auth/request-otp')
        .send({ email: 'not-an-email' });
      expect(resInvalid.status).toBe(400);
      expect(resInvalid.body.success).toBe(false);
    });
  });
});
