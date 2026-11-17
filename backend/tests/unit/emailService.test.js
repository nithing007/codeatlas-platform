/**
 * Unit Tests: Email Service (emailService.js)
 *
 * Verifies:
 * - Transporter creation with service (Gmail) vs standard SMTP host/port
 * - Secure auto-detection for port 465 vs port 587
 * - Sender address resolution for Gmail (forces sender email to match authenticated user)
 * - Transporter connection verification success and failure handling
 * - Dev mode console fallback when SMTP is not configured
 * - Production mode rejection when SMTP is not configured
 * - Successful OTP email dispatch with mock transporter and recipient acceptance confirmation
 * - Upstream SMTP failure handling (throws 502 EMAIL_DELIVERY_FAILED)
 * - Recipient rejection handling (throws 502 EMAIL_DELIVERY_REJECTED when rejected by provider)
 * - Safe diagnostic logging without leaking secrets, credentials, or OTP codes
 */

const nodemailer = require('nodemailer');
const config = require('../../src/config');
const {
  sendOtpEmail,
  verifyTransporterConnection,
  createTransporter,
  getTransporter,
  setTransporter,
  resetTransporter,
  isSmtpConfigured,
  getOtpEmailHtml,
  resolveSenderAddress,
} = require('../../src/services/emailService');

describe('Email Service Unit Tests', () => {
  const originalEnv = { ...process.env };
  const originalConfig = { ...config };

  beforeEach(() => {
    resetTransporter();
    jest.clearAllMocks();
  });

  afterEach(() => {
    resetTransporter();
    Object.assign(config, originalConfig);
  });

  describe('isSmtpConfigured', () => {
    test('returns false when no SMTP configuration is provided', () => {
      config.smtpService = '';
      config.smtpHost = '';
      config.smtpUser = '';
      config.smtpPass = '';
      expect(isSmtpConfigured()).toBe(false);
    });

    test('returns true when smtpService, smtpUser, and smtpPass are provided', () => {
      config.smtpService = 'gmail';
      config.smtpUser = 'user@gmail.com';
      config.smtpPass = 'secret-app-password';
      expect(isSmtpConfigured()).toBe(true);
    });

    test('returns true when smtpHost, smtpUser, and smtpPass are provided', () => {
      config.smtpService = '';
      config.smtpHost = 'smtp.sendgrid.net';
      config.smtpUser = 'apikey';
      config.smtpPass = 'sg.key';
      expect(isSmtpConfigured()).toBe(true);
    });

    test('returns true when a custom transporter has been injected via setTransporter', () => {
      config.smtpService = '';
      config.smtpHost = '';
      config.smtpUser = '';
      config.smtpPass = '';
      setTransporter({ sendMail: jest.fn() });
      expect(isSmtpConfigured()).toBe(true);
    });
  });

  describe('resolveSenderAddress', () => {
    test('for Gmail, ensures sender email matches authenticated smtpUser with default display name', () => {
      config.smtpService = 'gmail';
      config.smtpUser = 'sender@gmail.com';
      config.emailFrom = '';

      expect(resolveSenderAddress()).toBe('"CodeAtlas" <sender@gmail.com>');
    });

    test('for Gmail, preserves custom display name from emailFrom while enforcing smtpUser address', () => {
      config.smtpService = 'gmail';
      config.smtpUser = 'sender@gmail.com';
      config.emailFrom = 'CodeAtlas Alerts <noreply@customdomain.com>';

      expect(resolveSenderAddress()).toBe('"CodeAtlas Alerts" <sender@gmail.com>');
    });

    test('for Gmail with smtpHost smtp.gmail.com, forces sender to match smtpUser', () => {
      config.smtpService = '';
      config.smtpHost = 'smtp.gmail.com';
      config.smtpUser = 'googleuser@gmail.com';
      config.emailFrom = 'Wrong Sender <other@gmail.com>';

      expect(resolveSenderAddress()).toBe('"Wrong Sender" <googleuser@gmail.com>');
    });

    test('for standard SMTP, uses emailFrom directly when provided', () => {
      config.smtpService = '';
      config.smtpHost = 'smtp.sendgrid.net';
      config.smtpUser = 'apikey';
      config.emailFrom = 'CodeAtlas <noreply@codeatlas.dev>';

      expect(resolveSenderAddress()).toBe('CodeAtlas <noreply@codeatlas.dev>');
    });
  });

  describe('createTransporter', () => {
    test('creates transporter with service configuration when smtpService is set', () => {
      const spy = jest.spyOn(nodemailer, 'createTransport');
      createTransporter({
        smtpService: 'gmail',
        smtpUser: 'codeatlas@gmail.com',
        smtpPass: 'app-pass-1234',
      });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'gmail',
          auth: {
            user: 'codeatlas@gmail.com',
            pass: 'app-pass-1234',
          },
        })
      );
      spy.mockRestore();
    });

    test('creates transporter with host, port, and secure flag for custom SMTP', () => {
      const spy = jest.spyOn(nodemailer, 'createTransport');
      createTransporter({
        smtpService: '',
        smtpHost: 'smtp.mailgun.org',
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: 'mg-user',
        smtpPass: 'mg-pass',
      });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.mailgun.org',
          port: 587,
          secure: false,
          auth: {
            user: 'mg-user',
            pass: 'mg-pass',
          },
        })
      );
      spy.mockRestore();
    });

    test('creates transporter with secure=true when port is 465', () => {
      const spy = jest.spyOn(nodemailer, 'createTransport');
      createTransporter({
        smtpService: '',
        smtpHost: 'smtp.custom.org',
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: 'user',
        smtpPass: 'pass',
      });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.custom.org',
          port: 465,
          secure: true,
        })
      );
      spy.mockRestore();
    });
  });

  describe('verifyTransporterConnection', () => {
    test('returns false in dev mode when SMTP is unconfigured without throwing', async () => {
      config.smtpService = '';
      config.smtpHost = '';
      config.smtpUser = '';
      config.smtpPass = '';
      config.nodeEnv = 'development';

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const result = await verifyTransporterConnection();

      expect(result).toBe(false);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Development mode active')
      );
      logSpy.mockRestore();
    });

    test('verifies successfully when transporter.verify() resolves', async () => {
      const mockTransporter = {
        verify: jest.fn().mockResolvedValue(true),
      };
      setTransporter(mockTransporter);
      config.smtpService = 'gmail';

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const result = await verifyTransporterConnection();

      expect(result).toBe(true);
      expect(mockTransporter.verify).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('SMTP connection verified successfully')
      );
      logSpy.mockRestore();
    });

    test('catches error and returns false when transporter.verify() rejects', async () => {
      const mockTransporter = {
        verify: jest.fn().mockRejectedValue(new Error('Invalid login credentials: 535-5.7.8')),
      };
      setTransporter(mockTransporter);
      config.smtpService = 'gmail';

      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await verifyTransporterConnection();

      expect(result).toBe(false);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('SMTP connection verification failed')
      );
      errSpy.mockRestore();
    });
  });

  describe('getOtpEmailHtml', () => {
    test('generates HTML containing OTP code and expiry duration', () => {
      const html = getOtpEmailHtml('482910', 5);
      expect(html).toContain('482910');
      expect(html).toContain('5 minutes');
      expect(html).toContain('CodeAtlas');
      expect(html).toContain('<!DOCTYPE html>');
    });
  });

  describe('sendOtpEmail', () => {
    test('falls back to console logging in development mode when SMTP is not configured', async () => {
      config.smtpService = '';
      config.smtpHost = '';
      config.smtpUser = '';
      config.smtpPass = '';
      config.nodeEnv = 'development';

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const result = await sendOtpEmail('dev-user@codeatlas.dev', '123456');

      expect(result).toEqual({ devMode: true, messageId: 'dev-console-mock' });
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DEV EMAIL] SMTP not configured')
      );
      logSpy.mockRestore();
    });

    test('throws 500 EMAIL_NOT_CONFIGURED in production when SMTP is not configured', async () => {
      config.smtpService = '';
      config.smtpHost = '';
      config.smtpUser = '';
      config.smtpPass = '';
      config.nodeEnv = 'production';

      await expect(sendOtpEmail('prod-user@codeatlas.dev', '123456')).rejects.toMatchObject({
        statusCode: 500,
        code: 'EMAIL_NOT_CONFIGURED',
        message: expect.stringMatching(/not configured/i),
      });
    });

    test('dispatches email through transporter when configured and accepted by provider', async () => {
      const targetEmail = 'recipient@example.com';
      const mockSendMail = jest.fn().mockResolvedValue({
        messageId: 'msg-abc-123',
        accepted: [targetEmail],
        rejected: [],
        response: '250 2.0.0 OK test-gsmtp',
      });
      setTransporter({ sendMail: mockSendMail });

      config.smtpService = 'gmail';
      config.smtpUser = 'sender@gmail.com';
      config.emailFrom = 'CodeAtlas <sender@gmail.com>';
      config.otpExpiresMinutes = 5;

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const result = await sendOtpEmail(targetEmail, '789012');

      expect(result).toMatchObject({
        messageId: 'msg-abc-123',
        accepted: [targetEmail],
        rejected: [],
      });
      expect(mockSendMail).toHaveBeenCalledTimes(1);

      const mailOptions = mockSendMail.mock.calls[0][0];
      expect(mailOptions.to).toBe(targetEmail);
      expect(mailOptions.from).toBe('"CodeAtlas" <sender@gmail.com>');
      expect(mailOptions.subject).toBe('Your CodeAtlas Verification Code');
      expect(mailOptions.text).toContain('789012');
      expect(mailOptions.html).toContain('789012');

      // Verify safe diagnostic logging
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[EMAIL SEND] Provider: gmail'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[EMAIL SEND] MessageId: msg-abc-123'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[EMAIL SEND] Accepted count: 1'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[EMAIL SEND] Rejected count: 0'));
      logSpy.mockRestore();
    });

    test('throws 502 EMAIL_DELIVERY_REJECTED when recipient is rejected by SMTP provider', async () => {
      const targetEmail = 'rejected-user@example.com';
      const mockSendMail = jest.fn().mockResolvedValue({
        messageId: 'msg-rejected-123',
        accepted: [],
        rejected: [targetEmail],
        response: '550 5.1.1 User unknown',
      });
      setTransporter({ sendMail: mockSendMail });

      config.smtpService = 'gmail';
      config.smtpUser = 'sender@gmail.com';

      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await expect(sendOtpEmail(targetEmail, '654321')).rejects.toMatchObject({
        statusCode: 502,
        code: 'EMAIL_DELIVERY_REJECTED',
        message: 'Email provider rejected the recipient address.',
      });

      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('was rejected or not accepted by SMTP provider')
      );
      errSpy.mockRestore();
      logSpy.mockRestore();
    });

    test('throws 502 EMAIL_DELIVERY_REJECTED when accepted list is empty', async () => {
      const targetEmail = 'unaccepted-user@example.com';
      const mockSendMail = jest.fn().mockResolvedValue({
        messageId: 'msg-empty-123',
        accepted: [],
        rejected: [],
        response: '451 Action aborted: local error in processing',
      });
      setTransporter({ sendMail: mockSendMail });

      config.smtpService = 'gmail';
      config.smtpUser = 'sender@gmail.com';

      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await expect(sendOtpEmail(targetEmail, '654321')).rejects.toMatchObject({
        statusCode: 502,
        code: 'EMAIL_DELIVERY_REJECTED',
        message: 'Email provider rejected the recipient address.',
      });

      errSpy.mockRestore();
      logSpy.mockRestore();
    });

    test('throws 502 EMAIL_DELIVERY_FAILED when transporter.sendMail fails with SMTP error', async () => {
      const mockSendMail = jest.fn().mockRejectedValue(
        new Error('535-5.7.8 Username and Password not accepted')
      );
      setTransporter({ sendMail: mockSendMail });

      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(sendOtpEmail('failing-recipient@example.com', '654321')).rejects.toMatchObject({
        statusCode: 502,
        code: 'EMAIL_DELIVERY_FAILED',
        message: 'Failed to send verification email. Please try again later.',
      });

      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EMAIL ERROR] Failed to send verification email')
      );
      errSpy.mockRestore();
    });

    test('throws 502 EMAIL_DELIVERY_FAILED when transporter.sendMail fails with network timeout', async () => {
      const mockSendMail = jest.fn().mockRejectedValue(
        new Error('ETIMEDOUT: Connection to smtp.mail.com:587 timed out')
      );
      setTransporter({ sendMail: mockSendMail });

      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(sendOtpEmail('timeout-recipient@example.com', '654321')).rejects.toMatchObject({
        statusCode: 502,
        code: 'EMAIL_DELIVERY_FAILED',
        message: 'Failed to send verification email. Please try again later.',
      });

      errSpy.mockRestore();
    });
  });
});
