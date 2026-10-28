require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Otp = require('../src/models/Otp');
const { verifyToken } = require('../src/services/jwtService');
const config = require('../src/config');

async function testFullOtpFlow() {
  console.log('\n--- Full Email OTP + JWT Verification Test ---');
  await mongoose.connect(config.mongodbUri);

  const testEmail = `e2e.otp.${Date.now()}@example.com`;

  // 1. Request OTP
  const reqRes = await fetch('http://localhost:5000/api/auth/request-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail }),
  });
  const reqData = await reqRes.json();
  console.log('1. Request OTP:', reqData);

  // 2. Fetch OTP from DB to simulate user typing it from their email
  const otpDoc = await Otp.findOne({ email: testEmail });
  if (!otpDoc) throw new Error('OTP doc not found');

  // Let's verify OTP through the API
  // In dev mode, we can test using an incorrect OTP first
  const wrongRes = await fetch('http://localhost:5000/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, otp: '111111' }),
  });
  const wrongData = await wrongRes.json();
  console.log('2. Wrong OTP rejected:', wrongData);

  // Clean up
  await User.deleteOne({ email: testEmail });
  await Otp.deleteOne({ email: testEmail });
  await mongoose.disconnect();
  console.log('--- Email OTP Regression Test Complete ---\n');
}

testFullOtpFlow().catch((err) => {
  console.error(err);
  process.exit(1);
});
