/**
 * ProfilePage component tests.
 * Verifies rendering of authenticated user profile details, email/google auth provider badges,
 * role representation, and backend update notice (no client-side fake persistence).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ProfilePage } from '../../pages/ProfilePage.jsx';
import { AuthContext } from '../../context/AuthContext.jsx';

const emailUser = {
  _id: 'user-12345',
  name: 'Katherine Johnson',
  email: 'katherine@nasa.gov',
  authProvider: 'email',
  role: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const googleUser = {
  _id: 'user-67890',
  name: 'Alan Turing',
  email: 'alan@cambridge.edu',
  profilePicture: 'https://lh3.googleusercontent.com/avatar',
  authProvider: 'google',
  role: 'admin',
  createdAt: '2026-02-15T00:00:00.000Z',
  githubId: 'aturing',
};

function renderProfilePage(user = emailUser) {
  return render(
    <AuthContext.Provider value={{ user, isAuthenticated: true }}>
      <MemoryRouter initialEntries={['/profile']}>
        <ProfilePage />
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

describe('ProfilePage', () => {
  it('renders user personal information and email OTP status', () => {
    renderProfilePage(emailUser);

    expect(screen.getByRole('heading', { level: 1, name: /user profile/i })).toBeInTheDocument();
    expect(screen.getAllByText('Katherine Johnson').length).toBeGreaterThan(0);
    expect(screen.getAllByText('katherine@nasa.gov').length).toBeGreaterThan(0);
    expect(screen.getByText(/email one-time password/i)).toBeInTheDocument();
    expect(screen.getByText(/verified/i)).toBeInTheDocument();
  });

  it('renders Google OAuth details when authenticated via Google', () => {
    renderProfilePage(googleUser);

    expect(screen.getAllByText('Alan Turing').length).toBeGreaterThan(0);
    expect(screen.getAllByText('alan@cambridge.edu').length).toBeGreaterThan(0);
    expect(screen.getByText(/google oauth 2\.0/i)).toBeInTheDocument();
    expect(screen.getByText(/connected \(id: aturing\)/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /alan turing's avatar/i })).toBeInTheDocument();
  });

  it('displays read-only notice when clicking edit profile without fake persistence', async () => {
    renderProfilePage(emailUser);

    const editBtn = screen.getByRole('button', { name: /edit profile/i });
    await userEvent.click(editBtn);

    expect(screen.getByText(/backend update notice/i)).toBeInTheDocument();
    expect(screen.getByText(/patch \/api\/auth\/me/i)).toBeInTheDocument();
  });
});
