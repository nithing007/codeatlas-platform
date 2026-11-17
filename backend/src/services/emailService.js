/**
 * Email service
 * Handles dispatching verification emails (OTPs) using Nodemailer.
 *
 * Supported delivery modes:
 * 1. Dedicated SMTP Service (e.g. Gmail App Password via `service: 'gmail'`)
 * 2. Standard SMTP Server (SendGrid, Mailgun, AWS SES, MailHog, custom SMTP)
 * 3. Development / Test Fallback: If no SMTP credentials are configured and running in
 *    development/test, logs the OTP clearly to the terminal console so developers can proceed.
 *    In production without SMTP credentials, throws an error.
 */

const nodemailer = require('nodemailer');
const config = require('../config');

// Transporter cache / instance
let transporterInstance = null;

/**
 * Check whether SMTP delivery is configured via environment variables or manual setter.
 * @returns {boolean}
 */
const isSmtpConfigured = () => {
  if (transporterInstance) {
    return true;
  }
  if (config.smtpService && config.smtpUser && config.smtpPass) {
    return true;
  }
  if (config.smtpHost && config.smtpUser && config.smtpPass) {
    return true;
  }
  if (config.smtpHost && !config.smtpUser) {
    // Open relay / local testing SMTP (e.g. MailHog, Mailpit)
    return true;
  }
  return false;
};

/**
 * Resolve the sender address ensuring it complies with provider rules.
 * For Gmail, the email address must match the authenticated account (config.smtpUser).
 * @returns {string} Formatted sender address, e.g. '"CodeAtlas" <user@gmail.com>'
 */
const resolveSenderAddress = () => {
  const isGmail = config.smtpService === 'gmail' ||
    (config.smtpHost && config.smtpHost.toLowerCase().includes('gmail'));

  if (isGmail && config.smtpUser) {
    // Preserve custom display name if provided (e.g. 'CodeAtlas <...>' or '"CodeAtlas" <...>')
    let displayName = 'CodeAtlas';
    if (config.emailFrom) {
      const match = config.emailFrom.match(/^"?([^"<]+)"?\s*(?:<[^>]+>)?$/);
      if (match && match[1] && match[1].trim()) {
        displayName = match[1].trim();
      }
    }
    return `"${displayName}" <${config.smtpUser}>`;
  }

  return config.emailFrom || (config.smtpUser ? `"CodeAtlas" <${config.smtpUser}>` : 'CodeAtlas <noreply@codeatlas.dev>');
};

/**
 * Create a new Nodemailer transporter from current application configuration.
 * @param {Object} [overrideConfig] - Optional configuration overrides (for testing)
 * @returns {import('nodemailer').Transporter}
 */
const createTransporter = (overrideConfig = {}) => {
  const effectiveConfig = {
    service: overrideConfig.smtpService !== undefined ? overrideConfig.smtpService : config.smtpService,
    host: overrideConfig.smtpHost !== undefined ? overrideConfig.smtpHost : config.smtpHost,
    port: overrideConfig.smtpPort !== undefined ? overrideConfig.smtpPort : config.smtpPort,
    secure: overrideConfig.smtpSecure !== undefined ? overrideConfig.smtpSecure : config.smtpSecure,
    user: overrideConfig.smtpUser !== undefined ? overrideConfig.smtpUser : config.smtpUser,
    pass: overrideConfig.smtpPass !== undefined ? overrideConfig.smtpPass : config.smtpPass,
  };

  if (effectiveConfig.service) {
    return nodemailer.createTransport({
      service: effectiveConfig.service,
      auth: effectiveConfig.user && effectiveConfig.pass ? {
        user: effectiveConfig.user,
        pass: effectiveConfig.pass,
      } : undefined,
    });
  }

  return nodemailer.createTransport({
    host: effectiveConfig.host,
    port: effectiveConfig.port,
    secure: effectiveConfig.secure,
    auth: effectiveConfig.user && effectiveConfig.pass ? {
      user: effectiveConfig.user,
      pass: effectiveConfig.pass,
    } : undefined,
  });
};

/**
 * Get or initialize the cached Nodemailer transporter.
 * @returns {import('nodemailer').Transporter|null}
 */
const getTransporter = () => {
  if (!transporterInstance && isSmtpConfigured()) {
    transporterInstance = createTransporter();
  }
  return transporterInstance;
};

/**
 * Set an explicit transporter (used for unit/integration testing mocks).
 * @param {Object|null} transporter
 */
const setTransporter = (transporter) => {
  transporterInstance = transporter;
};

/**
 * Reset the cached transporter instance.
 */
const resetTransporter = () => {
  transporterInstance = null;
};

/**
 * Verify transporter connection during server startup or diagnostics.
 * Never logs credentials or secrets.
 * @returns {Promise<boolean>}
 */
const verifyTransporterConnection = async () => {
  if (!isSmtpConfigured()) {
    if (config.nodeEnv === 'development' || config.nodeEnv === 'test') {
      console.log('  [EMAIL] Development mode active: SMTP credentials not provided. OTPs will be logged to server console.');
    } else {
      console.warn('  [EMAIL WARNING] Production mode active but no SMTP credentials configured.');
    }
    return false;
  }

  const transporter = getTransporter();
  if (!transporter) {
    return false;
  }

  const destination = config.smtpService
    ? `service: ${config.smtpService}`
    : `host: ${config.smtpHost}:${config.smtpPort}`;

  try {
    await transporter.verify();
    console.log(`  [EMAIL] SMTP connection verified successfully (${destination})`);
    return true;
  } catch (err) {
    console.error(`  [EMAIL ERROR] SMTP connection verification failed (${destination}): ${err.message}`);
    return false;
  }
};

/**
 * Build responsive HTML template for the OTP verification email.
 * @param {string} otp
 * @param {number} expiresMinutes
 * @returns {string}
 */
const getOtpEmailHtml = (otp, expiresMinutes) => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your CodeAtlas Verification Code</title>
</head>
<body style="margin: 0; padding: 24px 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; margin: 0 auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 36px 32px; box-shadow: 0 4px 16px rgba(0,0,0,0.4);" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="padding-bottom: 24px;">
              <span style="font-size: 22px; font-weight: 700; color: #38bdf8; letter-spacing: -0.5px;">CodeAtlas</span>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom: 12px;">
              <h1 style="margin: 0; font-size: 20px; font-weight: 600; color: #f3f4f6;">Verification Code</h1>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom: 24px; font-size: 14px; line-height: 1.6; color: #9ca3af;">
              Use the single-use verification code below to sign in or register for your CodeAtlas account. This code expires in <strong style="color: #e5e7eb;">${expiresMinutes} minutes</strong>.
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <div style="background-color: #1e293b; border: 1px solid #38bdf8; border-radius: 8px; padding: 18px 24px; display: inline-block; text-align: center;">
                <span style="font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 700; letter-spacing: 8px; color: #38bdf8;">${otp}</span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom: 24px; font-size: 13px; line-height: 1.5; color: #6b7280;">
              If you did not request this verification code, you can safely ignore this email. Someone may have entered your email address by mistake.
            </td>
          </tr>
          <tr>
            <td style="border-top: 1px solid #1f2937; padding-top: 20px; font-size: 12px; color: #4b5563; text-align: center;">
              CodeAtlas &bull; Repository Intelligence &amp; Documentation Drift Detection
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

/**
 * Send an OTP email to the specified address.
 * @param {string} email - Recipient email address.
 * @param {string} otp - The plaintext OTP to send.
 * @returns {Promise<Object>} Delivery info or dev fallback result.
 * @throws {Error} If delivery fails or email service is not configured in production.
 */
const sendOtpEmail = async (email, otp) => {
  // If SMTP is NOT configured
  if (!isSmtpConfigured()) {
    if (config.nodeEnv === 'development' || config.nodeEnv === 'test') {
      // Development console fallback
      console.log('\n  ┌─────────────────────────────────────────────────────────────┐');
      console.log('  │  [DEV EMAIL] SMTP not configured — logging OTP to console   │');
      console.log(`  │  Recipient : ${email}`);
      console.log(`  │  Code      : ${otp}`);
      console.log(`  │  Expires in: ${config.otpExpiresMinutes} minutes`);
      console.log('  └─────────────────────────────────────────────────────────────┘\n');
      return { devMode: true, messageId: 'dev-console-mock' };
    }

    // Production mode requires a real email provider
    const notConfiguredError = new Error('Email service is not configured on this server.');
    notConfiguredError.statusCode = 500;
    notConfiguredError.code = 'EMAIL_NOT_CONFIGURED';
    throw notConfiguredError;
  }

  // SMTP IS configured (in dev, test, or production) — attempt real delivery
  const transporter = getTransporter();
  const fromAddress = resolveSenderAddress();

  const mailOptions = {
    from: fromAddress,
    to: email,
    subject: 'Your CodeAtlas Verification Code',
    text: `Your CodeAtlas verification code is: ${otp}\n\nThis code will expire in ${config.otpExpiresMinutes} minutes.\n\nIf you did not request this code, you can safely ignore this email.`,
    html: getOtpEmailHtml(otp, config.otpExpiresMinutes),
  };

  try {
    const info = await transporter.sendMail(mailOptions);

    // Inspect accepted and rejected recipients
    const accepted = Array.isArray(info && info.accepted) ? info.accepted : [];
    const rejected = Array.isArray(info && info.rejected) ? info.rejected : [];
    const normalizedTarget = email.toLowerCase().trim();

    const isAccepted = accepted.some((addr) => String(addr).toLowerCase().trim() === normalizedTarget);
    const isRejected = rejected.some((addr) => String(addr).toLowerCase().trim() === normalizedTarget);

    // Safe diagnostic logging (NO OTP, NO passwords, NO tokens)
    const providerLabel = config.smtpService || config.smtpHost || 'custom-smtp';
    console.log(`[EMAIL SEND] Provider: ${providerLabel}`);
    console.log(`[EMAIL SEND] Sender: ${fromAddress}`);
    console.log(`[EMAIL SEND] MessageId: ${info && info.messageId ? info.messageId : 'unknown'}`);
    console.log(`[EMAIL SEND] SMTP Response: ${info && info.response ? info.response : 'none'}`);
    console.log(`[EMAIL SEND] Accepted count: ${accepted.length}`);
    console.log(`[EMAIL SEND] Rejected count: ${rejected.length}`);

    // Verify recipient was accepted by provider
    if (!isAccepted || isRejected) {
      console.error(`[EMAIL ERROR] Recipient ${email} was rejected or not accepted by SMTP provider.`);
      const rejectionError = new Error('Email provider rejected the recipient address.');
      rejectionError.statusCode = 502;
      rejectionError.code = 'EMAIL_DELIVERY_REJECTED';
      rejectionError.details = {
        acceptedCount: accepted.length,
        rejectedCount: rejected.length,
        response: info ? info.response : null,
      };
      throw rejectionError;
    }

    console.log(`[EMAIL] Verification code successfully accepted by provider for ${email}`);
    return info;
  } catch (err) {
    if (err.code === 'EMAIL_DELIVERY_REJECTED') {
      throw err;
    }

    // Log the error details safely without leaking credentials
    console.error(`[EMAIL ERROR] Failed to send verification email to ${email}: ${err.message}`);

    const deliveryError = new Error('Failed to send verification email. Please try again later.');
    deliveryError.statusCode = 502;
    deliveryError.code = 'EMAIL_DELIVERY_FAILED';
    deliveryError.originalError = err.message;
    throw deliveryError;
  }
};

module.exports = {
  sendOtpEmail,
  verifyTransporterConnection,
  createTransporter,
  getTransporter,
  setTransporter,
  resetTransporter,
  isSmtpConfigured,
  getOtpEmailHtml,
  resolveSenderAddress,
};
