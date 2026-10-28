/**
 * Email service
 * Abstraction layer for sending emails.
 *
 * Development: logs OTP to server console (never in API responses).
 * Production: throws an error until a real provider is configured.
 *
 * To integrate a real provider (SendGrid, Resend, Nodemailer, etc.),
 * replace the implementation inside sendOtpEmail without changing the interface.
 */

const config = require('../config');

/**
 * Send an OTP email to the specified address.
 * @param {string} email - Recipient email address.
 * @param {string} otp - The plaintext OTP to send (only used inside this function).
 */
const sendOtpEmail = async (email, otp) => {
  if (config.nodeEnv === 'development' || config.nodeEnv === 'test') {
    // Development adapter — logs to console for testing
    console.log('\n  ┌─────────────────────────────────────┐');
    console.log(`  │  [DEV EMAIL] OTP for ${email}`);
    console.log(`  │  Code: ${otp}`);
    console.log(`  │  Expires in ${config.otpExpiresMinutes} minutes`);
    console.log('  └─────────────────────────────────────┘\n');
    return;
  }

  // Production — a real email provider must be configured
  // Replace this block with your provider integration:
  //
  // Example with Nodemailer:
  //   const transporter = nodemailer.createTransport({ ... });
  //   await transporter.sendMail({
  //     from: 'CodeAtlas <noreply@codeatlas.dev>',
  //     to: email,
  //     subject: 'Your CodeAtlas verification code',
  //     html: `<p>Your verification code is: <strong>${otp}</strong></p>`,
  //   });

  throw new Error(
    'Email provider not configured. Set up a real email service in src/services/emailService.js'
  );
};

module.exports = { sendOtpEmail };
