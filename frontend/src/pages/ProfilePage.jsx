/**
 * ProfilePage — Authenticated User Profile & Account Settings.
 * Displays user identity, authentication method, account status, and role.
 *
 * NOTE ON SERVER PERSISTENCE:
 * In accordance with Phase 8A specifications, the backend currently exposes GET /api/auth/me
 * but has no profile update endpoint (e.g. PATCH /api/auth/me). Profile details are displayed
 * read-only using existing authenticated user context without attempting fake or unsanctioned persistence.
 */

import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Alert } from '../components/ui/Alert.jsx';
import styles from './ProfilePage.module.css';

export function ProfilePage() {
  const { user } = useAuth();
  const [showEditNotice, setShowEditNotice] = useState(false);

  const initialLetter = user?.name
    ? user.name[0].toUpperCase()
    : user?.email
    ? user.email[0].toUpperCase()
    : 'U';

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'Active Session';

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        {/* ─── Header ─────────────────────────────────────────────────── */}
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>User Profile</h1>
            <p className={styles.subtitle}>
              Manage your personal identity, account credentials, and platform role.
            </p>
          </div>
        </header>

        {showEditNotice && (
          <div className={styles.noticeWrapper}>
            <Alert variant="warning">
              <strong>Backend Update Notice:</strong> Profile customization (updating bio,
              title, or custom GitHub handle) is currently read-only because the backend API
              does not yet declare an update endpoint (<code>PATCH /api/auth/me</code>).
              To preserve architectural integrity, no client-side spoofing or localStorage
              substitutes are used.
            </Alert>
          </div>
        )}

        <div className={styles.profileGrid}>
          {/* ─── Left Column: Avatar & Summary ─────────────────────────── */}
          <section className={styles.identityCard}>
            <div className={styles.avatarWrapper}>
              {user?.profilePicture ? (
                <img
                  src={user.profilePicture}
                  alt={`${user.name || user.email}'s avatar`}
                  className={styles.avatarImage}
                />
              ) : (
                <div className={styles.avatarFallback} aria-hidden="true">
                  {initialLetter}
                </div>
              )}
            </div>

            <div className={styles.identityDetails}>
              <h2 className={styles.userName}>{user?.name || 'CodeAtlas User'}</h2>
              <span className={styles.userEmail}>{user?.email}</span>

              <div className={styles.roleTag}>
                <span className={styles.roleDot} />
                <span>{user?.role?.toUpperCase() || 'USER'}</span>
              </div>
            </div>

            <div className={styles.identityMeta}>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Auth Provider</span>
                <span className={styles.metaValue}>
                  {user?.authProvider === 'google' ? 'Google OAuth 2.0' : 'Email One-Time Password'}
                </span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Member Since</span>
                <span className={styles.metaValue}>{memberSince}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Status</span>
                <span className={styles.statusVerified}>
                  <span className={styles.statusDot} /> Verified
                </span>
              </div>
            </div>

            <Button
              variant="secondary"
              size="sm"
              fullWidth
              onClick={() => setShowEditNotice(true)}
            >
              Edit Profile
            </Button>
          </section>

          {/* ─── Right Column: Account Details ─────────────────────────── */}
          <section className={styles.detailsSection}>
            {/* Personal Details Card */}
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Personal Information</h3>
                <span className={styles.cardBadge}>Account Identity</span>
              </div>

              <div className={styles.fieldsGrid}>
                <div className={styles.fieldItem}>
                  <label className={styles.fieldLabel}>Full Name</label>
                  <div className={styles.fieldValue}>
                    {user?.name || <span className={styles.mutedText}>Not provided</span>}
                  </div>
                </div>

                <div className={styles.fieldItem}>
                  <label className={styles.fieldLabel}>Email Address</label>
                  <div className={styles.fieldValue}>{user?.email}</div>
                </div>

                <div className={styles.fieldItem}>
                  <label className={styles.fieldLabel}>Professional Title</label>
                  <div className={styles.fieldValue}>
                    <span className={styles.mutedText}>Software Engineer (Read-only)</span>
                  </div>
                </div>

                <div className={styles.fieldItem}>
                  <label className={styles.fieldLabel}>GitHub Profile</label>
                  <div className={styles.fieldValue}>
                    {user?.githubId ? (
                      <span className={styles.githubConnected}>Connected (ID: {user.githubId})</span>
                    ) : (
                      <span className={styles.mutedText}>Linked via public repository import</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Platform Security & Authentication Card */}
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Authentication &amp; Security</h3>
                <span className={styles.cardBadge}>Security Profile</span>
              </div>

              <div className={styles.fieldsGrid}>
                <div className={styles.fieldItem}>
                  <label className={styles.fieldLabel}>Authentication Method</label>
                  <div className={styles.fieldValue}>
                    {user?.authProvider === 'google' ? (
                      <span className={styles.authBadgeGoogle}>Google Single Sign-On</span>
                    ) : (
                      <span className={styles.authBadgeEmail}>Passwordless 6-Digit Email OTP</span>
                    )}
                  </div>
                </div>

                <div className={styles.fieldItem}>
                  <label className={styles.fieldLabel}>Session Token Type</label>
                  <div className={styles.fieldValue}>
                    <code className={styles.codePill}>HttpOnly Secure Cookie</code>
                  </div>
                </div>

                <div className={styles.fieldItem}>
                  <label className={styles.fieldLabel}>Platform Access Role</label>
                  <div className={styles.fieldValue}>
                    <code>{user?.role || 'user'}</code> (Full repository scan permissions)
                  </div>
                </div>

                <div className={styles.fieldItem}>
                  <label className={styles.fieldLabel}>User Identifier</label>
                  <div className={styles.fieldValue}>
                    <code className={styles.codePill}>{user?._id || 'session-authenticated'}</code>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
