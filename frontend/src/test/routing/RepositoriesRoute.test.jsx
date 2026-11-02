/**
 * Repositories route protection test.
 * Verifies that /repositories route is protected and cannot be accessed
 * by unauthenticated users.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '../../components/routing/ProtectedRoute.jsx';
import { RepositoriesPage } from '../../pages/RepositoriesPage.jsx';
import { AuthContext } from '../../context/AuthContext.jsx';

// Mock the repositories API to avoid network calls
vi.mock('../../api/repositories.js', () => ({
  getRepositories: vi.fn().mockResolvedValue({ success: true, count: 0, repositories: [] }),
  addRepository: vi.fn(),
  previewRepository: vi.fn(),
}));

function renderRoute(authValue, initialPath = '/repositories') {
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/repositories"
            element={
              <ProtectedRoute>
                <RepositoriesPage />
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div data-testid="login-page">Login Page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

describe('Repositories route protection', () => {
  it('redirects unauthenticated users from /repositories to /login', () => {
    renderRoute({ isAuthenticated: false, isLoading: false, user: null });

    expect(screen.getByTestId('login-page')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /repositories/i })).not.toBeInTheDocument();
  });

  it('renders RepositoriesPage for authenticated users', async () => {
    renderRoute({
      isAuthenticated: true,
      isLoading: false,
      user: { email: 'developer@example.com' },
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /repositories/i })).toBeInTheDocument();
    });
  });
});
