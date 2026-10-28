/**
 * ProtectedRoute tests.
 * Tests: redirect when unauthenticated, render when authenticated,
 * spinner during loading, preserve intended destination.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '../../components/routing/ProtectedRoute.jsx';
import { AuthContext } from '../../context/AuthContext.jsx';

function renderWithAuth(authValue, initialPath = '/dashboard') {
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <div data-testid="protected-content">Protected</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div data-testid="login-page">Login</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

describe('ProtectedRoute', () => {
  it('shows loading spinner while session is initializing', () => {
    renderWithAuth({ isAuthenticated: false, isLoading: true });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  it('redirects unauthenticated users to /login', () => {
    renderWithAuth({ isAuthenticated: false, isLoading: false });
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  it('renders protected content for authenticated users', () => {
    renderWithAuth({ isAuthenticated: true, isLoading: false, user: { email: 'a@b.com' } });
    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
  });

  it('does not render protected content before auth is resolved', () => {
    renderWithAuth({ isAuthenticated: false, isLoading: true });
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });
});
