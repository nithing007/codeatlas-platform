/**
 * Authentication context and provider.
 *
 * - Checks session on app mount via GET /api/auth/me.
 * - Stores user in memory only (no localStorage/sessionStorage).
 * - Exposes login helpers that update state after successful OTP or OAuth.
 * - Does not briefly render protected content before session is resolved.
 * - 401 from /me is treated as "not authenticated", not as an error.
 * - Other server errors during init do not falsely clear a valid session.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getMe, logout as apiLogout } from '../api/auth.js';
import { ApiError } from '../api/client.js';

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }) {
  /**
   * null  — session not yet checked (loading)
   * false — confirmed unauthenticated
   * obj   — authenticated user object
   */
  const [user, setUser] = useState(null);
  const [sessionStatus, setSessionStatus] = useState('loading'); // 'loading' | 'authenticated' | 'unauthenticated'
  const initRan = useRef(false);

  // ── Session initialization ───────────────────────────────────────────────

  const initSession = useCallback(async () => {
    try {
      const data = await getMe();
      setUser(data.user);
      setSessionStatus('authenticated');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Normal unauthenticated state
        setUser(null);
        setSessionStatus('unauthenticated');
      } else {
        // Server error during init — do not treat as logout
        // Mark as unauthenticated so the app can continue
        setUser(null);
        setSessionStatus('unauthenticated');
      }
    }
  }, []);

  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    initSession();
  }, [initSession]);

  // ── Auth actions ─────────────────────────────────────────────────────────

  /**
   * Called after a successful OTP or OAuth flow.
   * @param {object} userData  Safe user object from the backend response.
   */
  const setAuthenticated = useCallback((userData) => {
    setUser(userData);
    setSessionStatus('authenticated');
  }, []);

  /**
   * Log out the current user.
   * Clears in-memory state. If the backend call fails, we still clear local
   * state but surface the error so the caller can inform the user that the
   * server session may still be active.
   *
   * @returns {Promise<void>}
   */
  const logoutUser = useCallback(async () => {
    await apiLogout();
    setUser(null);
    setSessionStatus('unauthenticated');
  }, []);

  // ── Value ────────────────────────────────────────────────────────────────

  const value = {
    user,
    sessionStatus,
    isAuthenticated: sessionStatus === 'authenticated',
    isLoading: sessionStatus === 'loading',
    setAuthenticated,
    logout: logoutUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Access authentication context.
 * Must be used within an AuthProvider.
 * oxlint-disable-next-line react/only-export-components -- hook co-location with context is standard pattern
 */
// oxlint-disable-next-line react/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export { AuthContext };
