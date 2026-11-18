/**
 * Application top navigation bar.
 * Shows the CodeAtlas wordmark and, when authenticated, navigation links + user info + logout button.
 * When unauthenticated, displays quick links and a Sign In button.
 * Supports mobile toggle menu.
 */

import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { Button } from '../ui/Button.jsx';
import { ApiError } from '../../api/client.js';
import styles from './Navbar.module.css';

export function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [prevPath, setPrevPath] = useState(location.pathname);

  // Close mobile menu on route change
  if (prevPath !== location.pathname) {
    setPrevPath(location.pathname);
    setMobileMenuOpen(false);
  }

  const handleLogout = async () => {
    setLoggingOut(true);
    setLogoutError('');
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setLogoutError('Sign-out request failed. Your local session has been cleared.');
      }
      navigate('/login', { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  const isActive = (path) => location.pathname === path;

  return (
    <header className={styles.header} role="banner">
      <nav className={styles.nav} aria-label="Main navigation">
        <div className={styles.navBrand}>
          <Link to="/" className={styles.wordmark} aria-label="CodeAtlas home">
            <span className={styles.wordmarkIcon} aria-hidden="true">◈</span>
            <span className={styles.wordmarkText}>CodeAtlas</span>
          </Link>

          {isAuthenticated && (
            <div className={styles.desktopNavLinks}>
              <Link
                to="/dashboard"
                className={`${styles.navLink} ${isActive('/dashboard') ? styles.navLinkActive : ''}`}
              >
                Dashboard
              </Link>
              <Link
                to="/repositories"
                className={`${styles.navLink} ${isActive('/repositories') ? styles.navLinkActive : ''}`}
              >
                Repositories
              </Link>
              <Link
                to="/profile"
                className={`${styles.navLink} ${isActive('/profile') ? styles.navLinkActive : ''}`}
              >
                Profile
              </Link>
            </div>
          )}
        </div>

        {/* Desktop actions */}
        <div className={styles.desktopActions}>
          {isAuthenticated && user ? (
            <div className={styles.userInfoGroup}>
              <Link to="/profile" className={styles.userProfileLink} title="View Profile">
                <span className={styles.userAvatar}>
                  {user.name ? user.name[0].toUpperCase() : user.email[0].toUpperCase()}
                </span>
                <span className={styles.userEmail} title={user.email}>
                  {user.name || user.email}
                </span>
              </Link>
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
            </div>
          ) : (
            <Link to="/login">
              <Button variant="primary" size="sm">
                Sign in
              </Button>
            </Link>
          )}
        </div>

        {/* Mobile menu toggle button */}
        <button
          type="button"
          className={styles.mobileToggle}
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-expanded={mobileMenuOpen}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
        >
          {mobileMenuOpen ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
      </nav>

      {/* Mobile drawer menu */}
      {mobileMenuOpen && (
        <div className={styles.mobileDrawer}>
          {isAuthenticated ? (
            <>
              <div className={styles.mobileUserInfo}>
                <span className={styles.userAvatar}>
                  {user?.name ? user.name[0].toUpperCase() : (user?.email ? user.email[0].toUpperCase() : 'U')}
                </span>
                <span className={styles.mobileEmail}>{user?.name || user?.email}</span>
              </div>
              <div className={styles.mobileLinks}>
                <Link to="/dashboard" className={styles.mobileLink}>
                  Dashboard
                </Link>
                <Link to="/repositories" className={styles.mobileLink}>
                  Repositories
                </Link>
                <Link to="/profile" className={styles.mobileLink}>
                  Profile
                </Link>
              </div>
              <div className={styles.mobileAction}>
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  onClick={handleLogout}
                  isLoading={loggingOut}
                >
                  Sign out
                </Button>
              </div>
            </>
          ) : (
            <div className={styles.mobileLinks}>
              <Link to="/" className={styles.mobileLink}>
                Home
              </Link>
              <Link to="/login" className={styles.mobileLink}>
                <Button variant="primary" size="md" fullWidth>
                  Sign in
                </Button>
              </Link>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
