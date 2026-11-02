/**
 * RepositoriesPage component tests.
 * Verifies fetching on mount, displaying repositories, error handling,
 * and state update when a new repository is added.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepositoriesPage } from '../../pages/RepositoriesPage.jsx';
import * as repositoriesApi from '../../api/repositories.js';
import { ApiError } from '../../api/client.js';

describe('RepositoriesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading spinner and then repository list on success', async () => {
    const mockRepos = [
      {
        _id: '1',
        name: 'repo-one',
        fullName: 'owner/repo-one',
        description: 'First repository',
        htmlUrl: 'https://github.com/owner/repo-one',
      },
    ];

    vi.spyOn(repositoriesApi, 'getRepositories').mockResolvedValueOnce({
      success: true,
      count: 1,
      repositories: mockRepos,
    });

    render(<RepositoriesPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('owner/repo-one')).toBeInTheDocument();
    });

    expect(screen.getByText('First repository')).toBeInTheDocument();
  });

  it('displays empty state when user has no repositories', async () => {
    vi.spyOn(repositoriesApi, 'getRepositories').mockResolvedValueOnce({
      success: true,
      count: 0,
      repositories: [],
    });

    render(<RepositoriesPage />);

    await waitFor(() => {
      expect(screen.getByText('No repositories added yet')).toBeInTheDocument();
    });
  });

  it('displays error message and retries on failure', async () => {
    vi.spyOn(repositoriesApi, 'getRepositories')
      .mockRejectedValueOnce(new ApiError('Backend unavailable', 500))
      .mockResolvedValueOnce({
        success: true,
        count: 1,
        repositories: [{ _id: '2', fullName: 'owner/recovered-repo' }],
      });

    render(<RepositoriesPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Backend unavailable');
    });

    const retryBtn = screen.getByRole('button', { name: /try again/i });
    await userEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('owner/recovered-repo')).toBeInTheDocument();
    });
  });

  it('adds newly created repository to the list', async () => {
    vi.spyOn(repositoriesApi, 'getRepositories').mockResolvedValueOnce({
      success: true,
      count: 0,
      repositories: [],
    });

    const newRepo = {
      _id: 'new-id',
      fullName: 'newowner/newrepo',
      description: 'Newly added repository',
      htmlUrl: 'https://github.com/newowner/newrepo',
    };

    vi.spyOn(repositoriesApi, 'addRepository').mockResolvedValueOnce({
      success: true,
      message: 'Repository imported successfully.',
      repository: newRepo,
    });

    render(<RepositoriesPage />);

    await waitFor(() => {
      expect(screen.getByText('No repositories added yet')).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/github repository url/i);
    await userEvent.type(input, 'https://github.com/newowner/newrepo');

    const submitBtn = screen.getByRole('button', { name: /add repository/i });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('newowner/newrepo')).toBeInTheDocument();
    });
    expect(screen.getByText('Newly added repository')).toBeInTheDocument();
  });
});
