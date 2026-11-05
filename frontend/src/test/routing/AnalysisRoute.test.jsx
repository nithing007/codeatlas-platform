/**
 * AnalysisRoute routing tests.
 * Verifies that the analysis route is protected — authenticated users can access it,
 * unauthenticated users are redirected to /login.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '../../components/routing/ProtectedRoute.jsx';
import { AuthContext } from '../../context/AuthContext.jsx';

vi.mock('../../pages/AnalysisResultsPage.jsx', () => ({
  AnalysisResultsPage: () => <div data-testid="analysis-page">Analysis Results</div>,
}));

import { AnalysisResultsPage } from '../../pages/AnalysisResultsPage.jsx';

function renderWithAuth(authValue, path = '/repositories/repo-1/scans/scan-1/analysis') {
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/repositories/:repositoryId/scans/:scanId/analysis"
            element={
              <ProtectedRoute>
                <AnalysisResultsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/repositories/:repositoryId/scans/:scanId/analysis/findings"
            element={
              <ProtectedRoute>
                <AnalysisResultsPage isFindingsView />
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div data-testid="login-page">Login</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

describe('Analysis route protection', () => {
  it('renders analysis page for authenticated users', () => {
    renderWithAuth({ isAuthenticated: true, isLoading: false, user: { email: 'a@b.com' } });
    expect(screen.getByTestId('analysis-page')).toBeInTheDocument();
  });

  it('renders findings page for authenticated users', () => {
    renderWithAuth(
      { isAuthenticated: true, isLoading: false, user: { email: 'a@b.com' } },
      '/repositories/repo-1/scans/scan-1/analysis/findings'
    );
    expect(screen.getByTestId('analysis-page')).toBeInTheDocument();
  });

  it('redirects unauthenticated users to /login', () => {
    renderWithAuth({ isAuthenticated: false, isLoading: false });
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
    expect(screen.queryByTestId('analysis-page')).not.toBeInTheDocument();
  });

  it('redirects unauthenticated users on findings route to /login', () => {
    renderWithAuth(
      { isAuthenticated: false, isLoading: false },
      '/repositories/repo-1/scans/scan-1/analysis/findings'
    );
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
    expect(screen.queryByTestId('analysis-page')).not.toBeInTheDocument();
  });

  it('shows loading spinner while auth is initializing', () => {
    renderWithAuth({ isAuthenticated: false, isLoading: true });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('analysis-page')).not.toBeInTheDocument();
  });
});

