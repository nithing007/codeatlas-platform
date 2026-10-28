/**
 * Application top navigation bar.
 * Shows the CodeAtlas wordmark and, when authenticated, user info + logout button.
 */

import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { Button } from '../ui/Button.jsx';
import { ApiError } from '../../api/client.js';
import styles from './Navbar.module.css';

export function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');

  const handleLogout = async () => {
    setLoggingOut(true);
    setLogoutError('');
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      // If logout API fails, we still clear local state (logout() already does)
      // but inform the user the server session may still be active.
      if (err instanceof ApiError) {
        setLogoutError('Sign-out request failed. Your local session has been cleared.');
      }
      navigate('/login', { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <header className={styles.header} role="banner">
      <nav className={styles.nav} aria-label="Main navigation">
        <Link to="/" className={styles.wordmark} aria-label="CodeAtlas home">
          <span className={styles.wordmarkIcon} aria-hidden="true">◈</span>
          <span className={styles.wordmarkText}>CodeAtlas</span>
        </Link>

        <div className={styles.actions}>
          {isAuthenticated && user ? (
            <>
              <span className={styles.userEmail} title={user.email}>
                {user.name || user.email}
              </span>
              {logoutError && (
                <span className={styles.logoutError} role="alert">
                  {logoutError}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                isLoading={loggingOut}
                aria-label="Sign out"
              >
                Sign out
              </Button>
            </>
          ) : null}
        </div>
      </nav>
    </header>
  );
}

