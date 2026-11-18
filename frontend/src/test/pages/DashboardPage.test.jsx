/**
 * DashboardPage component tests.
 * Verifies loading state, empty state when 0 repos, metrics calculation from real API responses,
 * repository list overview, and refresh button.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from '../../pages/DashboardPage.jsx';
import { AuthContext } from '../../context/AuthContext.jsx';
import * as repositoriesApi from '../../api/repositories.js';
import * as scansApi from '../../api/scans.js';

const mockUser = {
  name: 'Grace Hopper',
  email: 'grace@example.com',
  role: 'user',
};

function renderDashboard(user = mockUser) {
  return render(
    <AuthContext.Provider value={{ user, isAuthenticated: true }}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <DashboardPage />
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading spinner and empty state when user has 0 repositories', async () => {
    vi.spyOn(repositoriesApi, 'getRepositories').mockResolvedValueOnce({
      success: true,
      count: 0,
      repositories: [],
    });

    renderDashboard();

    expect(screen.getByRole('status')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/no repositories imported yet/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: /import your first repository/i })).toBeInTheDocument();
  });

  it('renders real metrics and overview cards when repositories and scans exist', async () => {
    const mockRepos = [
      {
        _id: 'repo-1',
        name: 'express-api',
        fullName: 'org/express-api',
        language: 'JavaScript',
        defaultBranch: 'main',
        visibility: 'public',
      },
    ];

    const mockScans = [
      {
        _id: 'scan-1',
        branch: 'main',
        status: 'COMPLETED',
        findingsCount: 3,
        filesScanned: 42,
        createdAt: '2026-11-18T10:00:00.000Z',
        completedAt: '2026-11-18T10:02:00.000Z',
      },
    ];

    vi.spyOn(repositoriesApi, 'getRepositories').mockResolvedValueOnce({
      success: true,
      count: 1,
      repositories: mockRepos,
    });

    vi.spyOn(scansApi, 'getRepositoryScans').mockResolvedValueOnce({
      success: true,
      scans: mockScans,
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getAllByText('org/express-api').length).toBeGreaterThan(0);
    });

    // Check metric labels
    expect(screen.getByText('Total Repositories')).toBeInTheDocument();
    expect(screen.getByText('Completed Scans')).toBeInTheDocument();
    expect(screen.getByText('In-Flight Scans')).toBeInTheDocument();
    expect(screen.getByText('Detected Drift Findings')).toBeInTheDocument();

    // Check repository overview card
    expect(screen.getAllByText('COMPLETED').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3 findings/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /view analysis/i })).toBeInTheDocument();
  });

  it('supports manual refresh button', async () => {
    vi.spyOn(repositoriesApi, 'getRepositories').mockResolvedValue({
      success: true,
      count: 0,
      repositories: [],
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/no repositories imported yet/i)).toBeInTheDocument();
    });

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    await userEvent.click(refreshBtn);

    expect(repositoriesApi.getRepositories).toHaveBeenCalledTimes(2);
  });
});
