require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const OAuthState = require('../src/models/OAuthState');
const { generateOAuthState, validateOAuthState } = require('../src/services/googleAuthService');
const { handleGoogleAuth } = require('../src/services/authService');
const config = require('../src/config');

async function runStateSecurityTests() {
  console.log('\n======================================================');
  console.log('  Phase 2B Security Hardening — OAuth State Tests');
  console.log('======================================================\n');

  // Test 1: Health check
  console.log('TEST 1: Health check endpoint');
  const healthRes = await fetch('http://localhost:5000/api/health');
  const healthData = await healthRes.json();
  console.log(`  Status: ${healthRes.status} | DB: ${healthData.database}`);
  if (healthRes.status !== 200) throw new Error('Health check failed');

  // Test 2: GET /api/auth/google sets cookie and includes matching state in URL
  console.log('\nTEST 2: GET /api/auth/google sets HttpOnly cookie & state parameter');
  const googleRes = await fetch('http://localhost:5000/api/auth/google', { redirect: 'manual' });
  const redirectUrl = googleRes.headers.get('location');
  const rawSetCookie = googleRes.headers.get('set-cookie');

  console.log(`  Status: ${googleRes.status}`);
  console.log(`  Set-Cookie present: ${Boolean(rawSetCookie)}`);

  if (!rawSetCookie || !rawSetCookie.includes('oauth_state=')) {
    throw new Error('Expected oauth_state cookie in response');
  }
  if (!rawSetCookie.toLowerCase().includes('httponly')) {
    throw new Error('oauth_state cookie must be HttpOnly');
  }

  const cookieMatch = rawSetCookie.match(/oauth_state=([^;]+)/);
  const cookieState = cookieMatch ? cookieMatch[1] : null;

  const urlObj = new URL(redirectUrl);
  const urlState = urlObj.searchParams.get('state');

  console.log(`  Cookie State (first 10 chars): ${cookieState ? cookieState.substring(0, 10) + '...' : 'none'}`);
  console.log(`  URL State (first 10 chars): ${urlState ? urlState.substring(0, 10) + '...' : 'none'}`);

  if (!cookieState || !urlState || cookieState !== urlState) {
    throw new Error('State in cookie does not match state in authorization URL');
  }
  console.log('  Validated: Cryptographic state generated, stored in HttpOnly cookie, and embedded in Google URL');

  // Connect to DB for testing validation logic
  await mongoose.connect(config.mongodbUri);

  // Test 3: Callback missing query state
  console.log('\nTEST 3: Callback missing query state parameter');
  const noStateRes = await fetch('http://localhost:5000/api/auth/google/callback?code=fake_code', {
    headers: { Cookie: `oauth_state=${cookieState}` },
  });
  const noStateData = await noStateRes.json();
  console.log(`  Status: ${noStateRes.status} | Error: "${noStateData.error}"`);
  if (noStateRes.status !== 400 || !noStateData.error) throw new Error('Expected 400 when query state is missing');

  // Test 4: Callback missing cookie state (CSRF / different browser attempt)
  console.log('\nTEST 4: Callback missing cookie state (Cross-browser / CSRF attempt)');
  const noCookieRes = await fetch(`http://localhost:5000/api/auth/google/callback?code=fake_code&state=${urlState}`);
  const noCookieData = await noCookieRes.json();
  console.log(`  Status: ${noCookieRes.status} | Error: "${noCookieData.error}"`);
  if (noCookieRes.status !== 400 || !noCookieData.error) throw new Error('Expected 400 when cookie state is missing');

  // Test 5: Callback mismatched state (tampered state)
  console.log('\nTEST 5: Callback with mismatched state');
  const badStateRes = await fetch(`http://localhost:5000/api/auth/google/callback?code=fake_code&state=wrong_tampered_state_value_12345678901234567890123456789012`, {
    headers: { Cookie: `oauth_state=${cookieState}` },
  });
  const badStateData = await badStateRes.json();
  console.log(`  Status: ${badStateRes.status} | Error: "${badStateData.error}"`);
  if (badStateRes.status !== 400 || !badStateData.error.includes('mismatch')) throw new Error('Expected 400 on state mismatch');

  // Test 6: Forged state not present in MongoDB
  console.log('\nTEST 6: Forged state matching cookie but not in MongoDB');
  const forgedState = 'a'.repeat(64);
  const forgedRes = await fetch(`http://localhost:5000/api/auth/google/callback?code=fake_code&state=${forgedState}`, {
    headers: { Cookie: `oauth_state=${forgedState}` },
  });
  const forgedData = await forgedRes.json();
  console.log(`  Status: ${forgedRes.status} | Error: "${forgedData.error}"`);
  if (forgedRes.status !== 400) throw new Error('Expected 400 on non-existent state');

  // Test 7: Single-use state verification
  console.log('\nTEST 7: State single-use verification (consumed once, second use fails)');
  const { state: singleUseState } = await generateOAuthState();
  const firstValidation = await validateOAuthState(singleUseState, singleUseState);
  console.log(`  First validation (consumption): ${firstValidation}`);

  let secondValidationFailed = false;
  try {
    await validateOAuthState(singleUseState, singleUseState);
  } catch (err) {
    secondValidationFailed = true;
    console.log(`  Second validation rejected as expected: "${err.message}"`);
  }
  if (!secondValidationFailed) {
    throw new Error('State was reused successfully; single-use enforcement failed');
  }

  // Test 8: Account linking regression test
  console.log('\nTEST 8: Google Account linking regression test');
  const testEmail = `state.test.${Date.now()}@example.com`;
  const existingUser = await User.create({ email: testEmail, authProvider: 'email' });
  const linkedGoogleId = `google_state_${Date.now()}`;

  const linkResult = await handleGoogleAuth({
    googleId: linkedGoogleId,
    email: testEmail,
    name: 'State Test User',
    profilePicture: 'https://example.com/pic.jpg',
  });
  console.log(`  Linked user ID: ${linkResult.user._id} (Matches original: ${linkResult.user._id.toString() === existingUser._id.toString()})`);
  if (linkResult.user._id.toString() !== existingUser._id.toString() || linkResult.user.googleId !== linkedGoogleId) {
    throw new Error('Account linking regression failed');
  }

  // Test 9: GET /me with generated JWT
  console.log('\nTEST 9: GET /api/auth/me with JWT');
  const meRes = await fetch('http://localhost:5000/api/auth/me', {
    headers: { Authorization: `Bearer ${linkResult.token}` },
  });
  const meData = await meRes.json();
  console.log(`  Status: ${meRes.status} | User: ${meData.user?.email}`);
  if (meRes.status !== 200 || meData.user?.email !== testEmail) {
    throw new Error('GET /api/auth/me failed');
  }

  // Test 10: Email OTP regression check
  console.log('\nTEST 10: Email OTP regression check (request-otp)');
  const otpRes = await fetch('http://localhost:5000/api/auth/request-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `otp.reg.${Date.now()}@example.com` }),
  });
  const otpData = await otpRes.json();
  console.log(`  Status: ${otpRes.status} | Success: ${otpData.success}`);
  if (otpRes.status !== 200 || !otpData.success) {
    throw new Error('Email OTP request failed');
  }

  // Clean up
  await User.deleteOne({ email: testEmail });
  await OAuthState.deleteMany({});
  await mongoose.disconnect();

  console.log('\n======================================================');
  console.log('  ALL OAUTH STATE & SECURITY TESTS PASSED! (10/10)');
  console.log('======================================================\n');
}

runStateSecurityTests().catch((err) => {
  console.error('\n❌ Security Test Error:', err);
  process.exit(1);
});
