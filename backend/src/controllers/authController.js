/**
 * Authentication controller
 * Thin request/response handlers that delegate to authService and googleAuthService,
 * and manage HttpOnly session cookies.
 */

const authService = require('../services/authService');
const googleAuthService = require('../services/googleAuthService');
const { setAuthCookie, clearAuthCookie } = require('../utils/cookieHelper');
const config = require('../config');

/**
 * POST /api/auth/request-otp
 * Request a new OTP for the given email.
 */
const requestOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    const result = await authService.requestOtp(email);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/verify-otp
 * Verify an OTP, set HttpOnly authentication cookie, and return safe user info.
 */
const verifyOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    const result = await authService.verifyOtp(email, otp);

    // Set the authentication JWT in a secure HttpOnly cookie
    setAuthCookie(res, result.token);

    // Return safe user information without exposing JWT in response body
    res.status(200).json({
      success: true,
      user: result.user,
      isNewUser: result.isNewUser,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/auth/google
 * Initiates the Google OAuth flow, generates cryptographically secure state,
 * sets temporary state cookie, and redirects user to Google's consent screen.
 */
const googleAuth = async (req, res, next) => {
  try {
    const { state, expiresAt } = await googleAuthService.generateOAuthState();

    // Store state in an HttpOnly, SameSite=Lax cookie associated with the browser session
    const isProduction = config.nodeEnv === 'production';
    res.cookie('oauth_state', state, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/api/auth/google',
      expires: expiresAt,
    });

    const url = googleAuthService.getAuthorizationUrl(state);
    res.redirect(url);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/auth/google/callback
 * Handles Google OAuth callback with authorization code & state, validates CSRF state,
 * verifies identity, sets HttpOnly authentication cookie, and redirects to frontend.
 */
const googleCallback = async (req, res, next) => {
  try {
    const { code, state, error } = req.query;
    const cookieState = req.cookies?.oauth_state;

    // Clear temporary OAuth state cookie after consumption
    res.clearCookie('oauth_state', {
      path: '/api/auth/google',
    });

    if (error) {
      const err = new Error(`Google authentication failed: ${error}`);
      err.statusCode = 400;
      throw err;
    }

    if (!code) {
      const err = new Error('Authorization code is missing from Google callback');
      err.statusCode = 400;
      throw err;
    }

    // Validate CSRF state parameter
    await googleAuthService.validateOAuthState(state, cookieState);

    // Verify token with Google and extract profile
    const googleUser = await googleAuthService.verifyGoogleCallback(code);

    // Find/create/link CodeAtlas user and generate CodeAtlas JWT
    const result = await authService.handleGoogleAuth(googleUser);

    // Set authentication JWT in secure HttpOnly cookie
    setAuthCookie(res, result.token);

    // Redirect browser to configured React frontend URL without exposing JWT in URL
    res.redirect(config.clientUrl);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/logout
 * Clears the authentication HttpOnly cookie.
 */
const logout = async (req, res, next) => {
  try {
    clearAuthCookie(res);
    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/auth/me
 * Return the authenticated user's information.
 */
const getMe = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      user: req.user.toSafeObject(),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/auth/protected (Development/Test Route)
 * Returns safe authenticated user information for verification.
 */
const getProtectedTest = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      message: 'Access granted to protected development route',
      user: req.user.toSafeObject(),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  requestOtp,
  verifyOtp,
  googleAuth,
  googleCallback,
  logout,
  getMe,
  getProtectedTest,
};
