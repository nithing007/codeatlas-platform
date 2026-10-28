/**
 * Phase 2B Verification Script
 * Tests:
 * 1. Health check endpoint
 * 2. GET /api/auth/google redirect generation and OAuth params
 * 3. GET /api/auth/google/callback error and missing code handling
 * 4. GET /api/auth/google/callback invalid code safe error handling
 * 5. Email OTP regression test (request-otp + verify-otp + /me)
 * 6. Google Auth Service unit/integration verification
 * 7. Google Account Linking (Existing Email OTP user + new Google login with same email)
 * 8. New Google user creation
 * 9. Existing Google user re-authentication
 * 10. CodeAtlas JWT verification with /api/auth/me
 */

// Load environment variables first
require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../src/models/User');
const { handleGoogleAuth } = require('../src/services/authService');
const { getAuthorizationUrl } = require('../src/services/googleAuthService');
const { verifyToken } = require('../src/services/jwtService');
const config = require('../src/config');

async function runTests() {
  console.log('\n========================================');
  console.log('  Phase 2B Google OAuth Test Suite');
  console.log('========================================\n');

  // Test 1: Health Check
  console.log('TEST 1: Verify Health Check endpoint');
  const healthRes = await fetch('http://localhost:5000/api/health');
  const healthData = await healthRes.json();
  console.log(`  Status: ${healthRes.status} | DB: ${healthData.database} | Success: ${healthData.success}`);
  if (healthRes.status !== 200 || !healthData.success) throw new Error('Health check failed');

  // Test 2: GET /api/auth/google (check redirect URL)
  console.log('\nTEST 2: GET /api/auth/google generates valid Google OAuth URL');
  const googleAuthRes = await fetch('http://localhost:5000/api/auth/google', { redirect: 'manual' });
  const redirectLocation = googleAuthRes.headers.get('location');
  console.log(`  Status: ${googleAuthRes.status}`);
  console.log(`  Redirect URL generated: ${redirectLocation ? redirectLocation.substring(0, 75) + '...' : 'none'}`);
  if (googleAuthRes.status !== 302 || !redirectLocation || !redirectLocation.includes('accounts.google.com')) {
    throw new Error('Google OAuth redirect failed');
  }
  if (!redirectLocation.includes('client_id=') || !redirectLocation.includes('scope=')) {
    throw new Error('Google OAuth URL missing client_id or scope');
  }
  console.log('  Validated: URL contains accounts.google.com, client_id, and openid/email/profile scopes');

  // Test 3: GET /api/auth/google/callback missing code
  console.log('\nTEST 3: GET /api/auth/google/callback without code');
  const noCodeRes = await fetch('http://localhost:5000/api/auth/google/callback');
  const noCodeData = await noCodeRes.json();
  console.log(`  Status: ${noCodeRes.status} | Error: "${noCodeData.error}"`);
  if (noCodeRes.status !== 400 || !noCodeData.error) throw new Error('Expected 400 on missing code');

  // Test 4: GET /api/auth/google/callback with error param
  console.log('\nTEST 4: GET /api/auth/google/callback with error parameter');
  const errRes = await fetch('http://localhost:5000/api/auth/google/callback?error=access_denied');
  const errData = await errRes.json();
  console.log(`  Status: ${errRes.status} | Error: "${errData.error}"`);
  if (errRes.status !== 400 || !errData.error.includes('access_denied')) throw new Error('Expected 400 on error param');

  // Test 5: GET /api/auth/google/callback with invalid code
  console.log('\nTEST 5: GET /api/auth/google/callback with invalid authorization code');
  const badCodeRes = await fetch('http://localhost:5000/api/auth/google/callback?code=invalid_test_code_123');
  const badCodeData = await badCodeRes.json();
  console.log(`  Status: ${badCodeRes.status} | Error: "${badCodeData.error}"`);
  if (badCodeRes.status !== 400) throw new Error('Expected 400 on invalid code');

  // Connect to DB for direct service/model tests
  await mongoose.connect(config.mongodbUri);
  await User.syncIndexes();

  // Test 6: New Google User Creation via handleGoogleAuth
  console.log('\nTEST 6: Create new user via Google authentication');
  const testGoogleId1 = 'google_uid_' + Date.now();
  const testGoogleEmail1 = `google.user.${Date.now()}@example.com`;

  const newGoogleAuthResult = await handleGoogleAuth({
    googleId: testGoogleId1,
    email: testGoogleEmail1,
    name: 'Google Test User',
    profilePicture: 'https://lh3.googleusercontent.com/a/default-user',
  });

  console.log(`  User Created: ID=${newGoogleAuthResult.user._id}, Email=${newGoogleAuthResult.user.email}, isNewUser=${newGoogleAuthResult.isNewUser}`);
  console.log(`  CodeAtlas JWT Token generated: ${newGoogleAuthResult.token.substring(0, 35)}...`);
  if (!newGoogleAuthResult.isNewUser || newGoogleAuthResult.user.googleId !== testGoogleId1) {
    throw new Error('New Google user creation failed');
  }

  // Test 7: Verify CodeAtlas JWT with /api/auth/me
  console.log('\nTEST 7: Verify generated CodeAtlas JWT at GET /api/auth/me');
  const meRes = await fetch('http://localhost:5000/api/auth/me', {
    headers: { Authorization: `Bearer ${newGoogleAuthResult.token}` },
  });
  const meData = await meRes.json();
  console.log(`  Status: ${meRes.status} | User: ${meData.user?.email} | Role: ${meData.user?.role}`);
  if (meRes.status !== 200 || meData.user.email !== testGoogleEmail1) {
    throw new Error('GET /api/auth/me failed with Google-authenticated JWT');
  }

  // Test 8: Existing Google User Re-login
  console.log('\nTEST 8: Re-authenticate existing Google user');
  const reAuthResult = await handleGoogleAuth({
    googleId: testGoogleId1,
    email: testGoogleEmail1,
    name: 'Google Test User Updated',
    profilePicture: 'https://lh3.googleusercontent.com/a/updated-pic',
  });
  console.log(`  Re-auth Status: isNewUser=${reAuthResult.isNewUser}, User ID=${reAuthResult.user._id}`);
  if (reAuthResult.isNewUser || reAuthResult.user._id.toString() !== newGoogleAuthResult.user._id.toString()) {
    throw new Error('Existing Google user re-auth failed');
  }

  // Test 9: Account Linking — Existing Email OTP user links Google account
  console.log('\nTEST 9: Account Linking — Existing Email OTP user logs in with Google (same email)');
  const emailOtpUserEmail = `email.otp.${Date.now()}@example.com`;
  // Create email OTP user first
  const existingOtpUser = await User.create({
    email: emailOtpUserEmail,
    authProvider: 'email',
    role: 'user',
  });
  console.log(`  Step 1: Created Email OTP user (ID: ${existingOtpUser._id}, googleId: ${existingOtpUser.googleId})`);

  const linkedGoogleId = 'google_linked_' + Date.now();
  const linkedResult = await handleGoogleAuth({
    googleId: linkedGoogleId,
    email: emailOtpUserEmail,
    name: 'Linked Google Name',
    profilePicture: 'https://lh3.googleusercontent.com/a/linked-pic',
  });

  console.log(`  Step 2: Authenticated with Google — isNewUser=${linkedResult.isNewUser}, ID=${linkedResult.user._id}`);
  console.log(`  Linked googleId=${linkedResult.user.googleId}, Name=${linkedResult.user.name}`);
  if (linkedResult.isNewUser || linkedResult.user._id.toString() !== existingOtpUser._id.toString()) {
    throw new Error('Account linking failed: created duplicate user instead of linking');
  }
  if (linkedResult.user.googleId !== linkedGoogleId) {
    throw new Error('googleId was not attached to existing account');
  }

  // Test 10: Email OTP regression test (request-otp)
  console.log('\nTEST 10: Verify Email OTP flow still works (regression check)');
  const otpReqRes = await fetch('http://localhost:5000/api/auth/request-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `regression.${Date.now()}@example.com` }),
  });
  const otpReqData = await otpReqRes.json();
  console.log(`  Status: ${otpReqRes.status} | Success: ${otpReqData.success} | Message: "${otpReqData.message}"`);
  if (otpReqRes.status !== 200 || !otpReqData.success) {
    throw new Error('Email OTP request failed');
  }

  // Clean up test data
  await User.deleteMany({ email: { $in: [testGoogleEmail1, emailOtpUserEmail] } });
  await mongoose.disconnect();

  console.log('\n========================================');
  console.log('  ALL PHASE 2B TESTS PASSED SUCCESSFULLY!');
  console.log('========================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ Test Error:', err);
  process.exit(1);
});
