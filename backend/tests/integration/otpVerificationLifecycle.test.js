/**
 * Integration Tests: OTP Verification Lifecycle & Invariants (Phase 7C.1C)
 *
 * Verifies:
 * 1. Correct OTP succeeds (creates/retrieves user, issues JWT, deletes OTP record)
 * 2. Incorrect OTP fails (increments attempts counter, reports remaining attempts)
 * 3. Expired OTP fails (deletes expired record, reports expired code)
 * 4. Latest OTP succeeds when requested after previous code
 * 5. Previous OTP is rejected after replacement (previous code invalidated upon new request)
 * 6. OTP is strictly single-use (cannot be verified twice)
 * 7. Wrong email fails (reports no verification code found)
 * 8. Attempt limits work correctly (exceeding max attempts purges OTP and rejects)
 * 9. Whitespace-padded OTP inputs are safely sanitized
 */

const bcrypt = require('bcryptjs');
const Otp = require('../../src/models/Otp');
const User = require('../../src/models/User');
const authService = require('../../src/services/authService');
const emailService = require('../../src/services/emailService');
const config = require('../../src/config');
const { connectTestDb, cleanTestDb, disconnectTestDb } = require('../helpers/testDb');

describe('OTP Verification Lifecycle & Security Invariants', () => {
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
    await User.deleteMany({});
  });

  afterEach(async () => {
    emailService.resetTransporter();
  });

  test('1. Correct OTP succeeds, returns user and token, and deletes OTP from DB', async () => {
    const email = 'correct-otp@codeatlas.test';
    let capturedOtp = null;

    const mockTransporter = {
      sendMail: jest.fn().mockImplementation(async (mailOptions) => {
        const match = mailOptions.text.match(/\b\d{6}\b/);
        capturedOtp = match ? match[0] : null;
        return {
          messageId: 'mock-msg-correct',
          accepted: [email],
          rejected: [],
          response: '250 OK',
        };
      }),
    };
    emailService.setTransporter(mockTransporter);

    await authService.requestOtp(email);
    expect(capturedOtp).not.toBeNull();

    // Verify OTP document exists in DB before verification
    const docBefore = await Otp.findOne({ email });
    expect(docBefore).not.toBeNull();

    // Verify with the captured plaintext OTP
    const result = await authService.verifyOtp(email, capturedOtp);

    expect(result.user).toBeDefined();
    expect(result.user.email).toBe(email);
    expect(result.token).toBeDefined();
    expect(result.isNewUser).toBe(true);

    // Verify OTP document was deleted from DB (single-use)
    const docAfter = await Otp.findOne({ email });
    expect(docAfter).toBeNull();
  });

  test('2. Incorrect OTP fails, increments attempts, and returns remaining attempts', async () => {
    const email = 'incorrect-otp@codeatlas.test';
    const plaintextOtp = '123456';
    const salt = await bcrypt.genSalt(10);
    const hashedOtp = await bcrypt.hash(plaintextOtp, salt);

    await Otp.create({
      email,
      hashedOtp,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      attempts: 0,
    });

    // Attempt with wrong code
    await expect(authService.verifyOtp(email, '999999')).rejects.toMatchObject({
      statusCode: 401,
      message: expect.stringMatching(/Invalid verification code.*4 attempts remaining/i),
    });

    // Inspect attempt counter in DB
    const doc = await Otp.findOne({ email });
    expect(doc).not.toBeNull();
    expect(doc.attempts).toBe(1);
  });

  test('3. Expired OTP fails and purges the expired record', async () => {
    const email = 'expired-otp@codeatlas.test';
    const plaintextOtp = '555666';
    const salt = await bcrypt.genSalt(10);
    const hashedOtp = await bcrypt.hash(plaintextOtp, salt);

    await Otp.create({
      email,
      hashedOtp,
      expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
      attempts: 0,
    });

    await expect(authService.verifyOtp(email, plaintextOtp)).rejects.toMatchObject({
      statusCode: 401,
      message: expect.stringMatching(/expired/i),
    });

    // Verify document was purged
    const doc = await Otp.findOne({ email });
    expect(doc).toBeNull();
  });

  test('4 & 5. Latest OTP succeeds and previous OTP is rejected after replacement', async () => {
    const email = 'replacement@codeatlas.test';
    let otp1 = null;
    let otp2 = null;

    const mockTransporter = {
      sendMail: jest.fn().mockImplementation(async (mailOptions) => {
        const match = mailOptions.text.match(/\b\d{6}\b/);
        return {
          messageId: 'mock-msg',
          accepted: [email],
          rejected: [],
          response: '250 OK',
        };
      }),
    };
    emailService.setTransporter(mockTransporter);

    // Request first OTP
    mockTransporter.sendMail.mockImplementationOnce(async (options) => {
      otp1 = options.text.match(/\b\d{6}\b/)[0];
      return { messageId: 'm1', accepted: [email], rejected: [] };
    });
    await authService.requestOtp(email);
    expect(otp1).not.toBeNull();

    // Fast-forward cooldown by updating createdAt in DB to 70 seconds ago
    await Otp.updateOne({ email }, { createdAt: new Date(Date.now() - 70 * 1000) });

    // Request second OTP
    mockTransporter.sendMail.mockImplementationOnce(async (options) => {
      otp2 = options.text.match(/\b\d{6}\b/)[0];
      return { messageId: 'm2', accepted: [email], rejected: [] };
    });
    await authService.requestOtp(email);
    expect(otp2).not.toBeNull();

    // Attempting with OLD OTP (otp1) must be rejected
    await expect(authService.verifyOtp(email, otp1)).rejects.toMatchObject({
      statusCode: 401,
      message: expect.stringMatching(/Invalid verification code/i),
    });

    // Attempting with NEW OTP (otp2) must succeed
    const result = await authService.verifyOtp(email, otp2);
    expect(result.user.email).toBe(email);
    expect(result.token).toBeDefined();
  });

  test('6. OTP is strictly single-use and cannot be verified twice', async () => {
    const email = 'single-use@codeatlas.test';
    let capturedOtp = null;

    const mockTransporter = {
      sendMail: jest.fn().mockImplementation(async (mailOptions) => {
        capturedOtp = mailOptions.text.match(/\b\d{6}\b/)[0];
        return { messageId: 'msg', accepted: [email], rejected: [] };
      }),
    };
    emailService.setTransporter(mockTransporter);

    await authService.requestOtp(email);

    // First verification succeeds
    const firstResult = await authService.verifyOtp(email, capturedOtp);
    expect(firstResult.user.email).toBe(email);

    // Immediate second verification with the same OTP fails
    await expect(authService.verifyOtp(email, capturedOtp)).rejects.toMatchObject({
      statusCode: 401,
      message: expect.stringMatching(/No verification code found/i),
    });
  });

  test('7. Wrong email fails with 401 no code found', async () => {
    const emailA = 'user-a@codeatlas.test';
    const emailB = 'user-b@codeatlas.test';
    let capturedOtp = null;

    const mockTransporter = {
      sendMail: jest.fn().mockImplementation(async (mailOptions) => {
        capturedOtp = mailOptions.text.match(/\b\d{6}\b/)[0];
        return { messageId: 'msg', accepted: [mailOptions.to], rejected: [] };
      }),
    };
    emailService.setTransporter(mockTransporter);

    await authService.requestOtp(emailA);

    // Attempt verification with emailB
    await expect(authService.verifyOtp(emailB, capturedOtp)).rejects.toMatchObject({
      statusCode: 401,
      message: expect.stringMatching(/No verification code found/i),
    });
  });

  test('8. Attempt limits work correctly: exceeding max attempts purges OTP and rejects', async () => {
    const email = 'attempts-limit@codeatlas.test';
    const plaintextOtp = '444333';
    const salt = await bcrypt.genSalt(10);
    const hashedOtp = await bcrypt.hash(plaintextOtp, salt);

    await Otp.create({
      email,
      hashedOtp,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      attempts: config.otpMaxAttempts - 1, // already at 4 attempts
    });

    // 5th attempt fails and exhausts attempts
    await expect(authService.verifyOtp(email, '000000')).rejects.toMatchObject({
      statusCode: 401,
      message: expect.stringMatching(/0 attempts remaining/i),
    });

    // 6th attempt (or subsequent attempt with any code, even correct one) is blocked
    await expect(authService.verifyOtp(email, plaintextOtp)).rejects.toMatchObject({
      statusCode: 401,
      message: expect.stringMatching(/Maximum verification attempts exceeded/i),
    });

    // Verify OTP document was purged
    const doc = await Otp.findOne({ email });
    expect(doc).toBeNull();
  });

  test('9. Whitespace-padded OTP inputs are safely sanitized and verified', async () => {
    const email = 'padded-otp@codeatlas.test';
    let capturedOtp = null;

    const mockTransporter = {
      sendMail: jest.fn().mockImplementation(async (mailOptions) => {
        capturedOtp = mailOptions.text.match(/\b\d{6}\b/)[0];
        return { messageId: 'msg', accepted: [email], rejected: [] };
      }),
    };
    emailService.setTransporter(mockTransporter);

    await authService.requestOtp(email);

    // Pass OTP with leading and trailing spaces
    const paddedOtp = `  ${capturedOtp}  `;
    const result = await authService.verifyOtp(email, paddedOtp);

    expect(result.user.email).toBe(email);
    expect(result.token).toBeDefined();
  });
});

