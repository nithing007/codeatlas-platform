require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Otp = require('../src/models/Otp');
const OAuthState = require('../src/models/OAuthState');
const { generateToken } = require('../src/services/jwtService');
const { generateOAuthState } = require('../src/services/googleAuthService');
const { handleGoogleAuth } = require('../src/services/authService');
const config = require('../src/config');

async function runPhase2CTests() {
  console.log('\n=============================================================');
  console.log('  Phase 2C Authentication & Authorization Test Suite');
  console.log('=============================================================\n');

  await mongoose.connect(config.mongodbUri);

  // -------------------------------------------------------------
  // Test 1: Health Check (Phase 1 Regression)
  // -------------------------------------------------------------
  console.log('TEST 1: Health check endpoint');
  const healthRes = await fetch('http://localhost:5000/api/health');
  const healthData = await healthRes.json();
  console.log(`  Status: ${healthRes.status} | DB: ${healthData.database}`);
  if (healthRes.status !== 200 || !healthData.success) throw new Error('Health check failed');

  // -------------------------------------------------------------
  // Test 2: Email OTP Login -> Sets HttpOnly Cookie, Body Has No JWT
  // -------------------------------------------------------------
  console.log('\nTEST 2: Email OTP Verification sets HttpOnly auth cookie');
  const testUserEmail = `phase2c.user.${Date.now()}@example.com`;

  // Request OTP
  const reqRes = await fetch('http://localhost:5000/api/auth/request-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testUserEmail }),
  });
  if (reqRes.status !== 200) throw new Error('Request OTP failed');

  // In test environment, retrieve the plain OTP by generating a known hash or verifying
  // Let's create a known OTP in DB directly to verify through the API endpoint
  const bcrypt = require('bcryptjs');
  const testOtpCode = '765432';
  const hashedOtp = await bcrypt.hash(testOtpCode, 10);
  await Otp.findOneAndUpdate(
    { email: testUserEmail },
    { hashedOtp, expiresAt: new Date(Date.now() + 5 * 60 * 1000), attempts: 0 },
    { upsert: true }
  );

  // Verify OTP via API (and attempt malicious self-promotion in body)
  const verifyRes = await fetch('http://localhost:5000/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testUserEmail,
      otp: testOtpCode,
      role: 'ADMIN', // Malicious attempt to self-promote
    }),
  });

  const verifyData = await verifyRes.json();
  const rawSetCookie = verifyRes.headers.get('set-cookie');

  console.log(`  Verify Status: ${verifyRes.status}`);
  console.log(`  Response User: email=${verifyData.user?.email}, role=${verifyData.user?.role}`);
  console.log(`  JWT in response body: ${verifyData.token ? 'YES (FAILED)' : 'NO (SECURE ✅)'}`);
  console.log(`  Set-Cookie Header: ${rawSetCookie ? 'PRESENT ✅' : 'MISSING ❌'}`);

  if (verifyRes.status !== 200) throw new Error('Verify OTP failed');
  if (verifyData.token) throw new Error('Security violation: JWT should not be in response body');
  if (!rawSetCookie || !rawSetCookie.includes(`${config.authCookieName}=`)) {
    throw new Error(`Missing ${config.authCookieName} cookie in response`);
  }
  if (!rawSetCookie.toLowerCase().includes('httponly')) {
    throw new Error('Auth cookie must be HttpOnly');
  }

  // Extract auth cookie value
  const authCookieMatch = rawSetCookie.match(new RegExp(`${config.authCookieName}=([^;]+)`));
  const authCookie = authCookieMatch ? authCookieMatch[1] : null;

  // -------------------------------------------------------------
  // Test 3: Default Role & Self-Promotion Prevention
  // -------------------------------------------------------------
  console.log('\nTEST 3: User creation defaults to USER role & rejects self-promotion');
  console.log(`  Role in response: ${verifyData.user.role}`);
  if (verifyData.user.role.toUpperCase() !== 'USER') {
    throw new Error(`Expected default role USER, got ${verifyData.user.role}`);
  }
  const dbUser = await User.findOne({ email: testUserEmail });
  if (dbUser.role.toUpperCase() !== 'USER') {
    throw new Error(`DB user role is ${dbUser.role}, expected user`);
  }
  console.log('  Validated: New user assigned USER role, role field in request payload was safely ignored');

  // -------------------------------------------------------------
  // Test 4: GET /api/auth/me using HttpOnly cookie
  // -------------------------------------------------------------
  console.log('\nTEST 4: GET /api/auth/me using HttpOnly authentication cookie');
  const meRes = await fetch('http://localhost:5000/api/auth/me', {
    headers: { Cookie: `${config.authCookieName}=${authCookie}` },
  });
  const meData = await meRes.json();
  console.log(`  Status: ${meRes.status} | User: ${meData.user?.email} | Role: ${meData.user?.role}`);
  if (meRes.status !== 200 || meData.user.email !== testUserEmail) {
    throw new Error('GET /api/auth/me with cookie failed');
  }

  // -------------------------------------------------------------
  // Test 5: GET /api/auth/protected using cookie
  // -------------------------------------------------------------
  console.log('\nTEST 5: GET /api/auth/protected development test endpoint');
  const protRes = await fetch('http://localhost:5000/api/auth/protected', {
    headers: { Cookie: `${config.authCookieName}=${authCookie}` },
  });
  const protData = await protRes.json();
  console.log(`  Status: ${protRes.status} | Message: "${protData.message}"`);
  if (protRes.status !== 200 || !protData.success) throw new Error('Protected route test failed');

  // -------------------------------------------------------------
  // Test 6: Missing cookie returns 401 Unauthorized
  // -------------------------------------------------------------
  console.log('\nTEST 6: Missing cookie returns 401 Unauthorized');
  const noCookieRes = await fetch('http://localhost:5000/api/auth/me');
  const noCookieData = await noCookieRes.json();
  console.log(`  Status: ${noCookieRes.status} | Error: "${noCookieData.error}"`);
  if (noCookieRes.status !== 401 || !noCookieData.error) throw new Error('Expected 401 on missing cookie');

  // -------------------------------------------------------------
  // Test 7: Invalid cookie returns 401 Unauthorized
  // -------------------------------------------------------------
  console.log('\nTEST 7: Invalid cookie returns 401 Unauthorized');
  const badCookieRes = await fetch('http://localhost:5000/api/auth/me', {
    headers: { Cookie: `${config.authCookieName}=invalid_tampered_jwt_token` },
  });
  const badCookieData = await badCookieRes.json();
  console.log(`  Status: ${badCookieRes.status} | Error: "${badCookieData.error}"`);
  if (badCookieRes.status !== 401) throw new Error('Expected 401 on invalid cookie');

  // -------------------------------------------------------------
  // Test 8: USER Role Forbidden from Admin Route (403)
  // -------------------------------------------------------------
  console.log('\nTEST 8: USER role accessing admin route receives 403 Forbidden');
  const userAdminRes = await fetch('http://localhost:5000/api/admin/test', {
    headers: { Cookie: `${config.authCookieName}=${authCookie}` },
  });
  const userAdminData = await userAdminRes.json();
  console.log(`  Status: ${userAdminRes.status} | Error: "${userAdminData.error}"`);
  if (userAdminRes.status !== 403 || !userAdminData.error.includes('Forbidden')) {
    throw new Error('Expected 403 Forbidden for USER on admin route');
  }

  // -------------------------------------------------------------
  // Test 9: ADMIN Role Accesses Admin Route (200 OK)
  // -------------------------------------------------------------
  console.log('\nTEST 9: ADMIN role accessing admin route receives 200 OK');
  const adminEmail = `admin.user.${Date.now()}@example.com`;
  const adminUser = await User.create({
    email: adminEmail,
    role: 'admin',
    authProvider: 'email',
  });
  const adminToken = generateToken({ id: adminUser._id, role: adminUser.role });

  const adminRes = await fetch('http://localhost:5000/api/admin/test', {
    headers: { Cookie: `${config.authCookieName}=${adminToken}` },
  });
  const adminData = await adminRes.json();
  console.log(`  Status: ${adminRes.status} | Message: "${adminData.message}" | User Role: ${adminData.user?.role}`);
  if (adminRes.status !== 200 || !adminData.success) {
    throw new Error('ADMIN role access to admin route failed');
  }

  // -------------------------------------------------------------
  // Test 10: Backward-Compatible Bearer Token Header Fallback
  // -------------------------------------------------------------
  console.log('\nTEST 10: Authorization: Bearer header fallback works for API clients');
  const bearerRes = await fetch('http://localhost:5000/api/auth/me', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const bearerData = await bearerRes.json();
  console.log(`  Status: ${bearerRes.status} | User: ${bearerData.user?.email}`);
  if (bearerRes.status !== 200 || bearerData.user.email !== adminEmail) {
    throw new Error('Bearer fallback failed');
  }

  // -------------------------------------------------------------
  // Test 11: POST /api/auth/logout clears auth cookie
  // -------------------------------------------------------------
  console.log('\nTEST 11: POST /api/auth/logout clears auth cookie');
  const logoutRes = await fetch('http://localhost:5000/api/auth/logout', {
    method: 'POST',
    headers: { Cookie: `${config.authCookieName}=${authCookie}` },
  });
  const logoutData = await logoutRes.json();
  const logoutSetCookie = logoutRes.headers.get('set-cookie');
  console.log(`  Status: ${logoutRes.status} | Message: "${logoutData.message}"`);
  console.log(`  Logout Set-Cookie: ${logoutSetCookie}`);
  if (logoutRes.status !== 200 || !logoutSetCookie || !logoutSetCookie.includes(`${config.authCookieName}=;`)) {
    throw new Error('Logout failed to clear auth cookie');
  }

  // -------------------------------------------------------------
  // Test 12: Google OAuth URL redirect check (No JWT in URL)
  // -------------------------------------------------------------
  console.log('\nTEST 12: Google OAuth flow redirects without exposing JWT in URL');
  const googleRes = await fetch('http://localhost:5000/api/auth/google', { redirect: 'manual' });
  const googleRedirectUrl = googleRes.headers.get('location');
  console.log(`  Status: ${googleRes.status}`);
  console.log(`  Redirect URL: ${googleRedirectUrl.substring(0, 60)}...`);
  if (!googleRedirectUrl.includes('accounts.google.com') || googleRedirectUrl.includes('jwt') || googleRedirectUrl.includes('token=')) {
    throw new Error('Google OAuth initiation exposed tokens or failed to redirect');
  }

  // Clean up
  await User.deleteMany({ email: { $in: [testUserEmail, adminEmail] } });
  await Otp.deleteMany({ email: testUserEmail });
  await OAuthState.deleteMany({});
  await mongoose.disconnect();

  console.log('\n=============================================================');
  console.log('  ALL PHASE 2C TESTS PASSED SUCCESSFULLY! (12/12)');
  console.log('=============================================================\n');
}

runPhase2CTests().catch((err) => {
  console.error('\n❌ Phase 2C Test Error:', err);
  process.exit(1);
});
