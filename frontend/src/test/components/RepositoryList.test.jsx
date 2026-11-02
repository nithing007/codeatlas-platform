/**
 * RepositoryList component tests.
 * Verifies loading, error, empty, and populated states.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepositoryList } from '../../components/repositories/RepositoryList.jsx';

describe('RepositoryList', () => {
  it('renders loading spinner when isLoading is true', () => {
    render(<RepositoryList isLoading={true} repositories={[]} />);

    expect(screen.getByRole('status', { name: /loading repositories/i })).toBeInTheDocument();
    expect(screen.getAllByText('Loading repositories…').length).toBeGreaterThan(0);
    expect(screen.queryByText('No repositories added yet')).not.toBeInTheDocument();
  });

  it('renders error message and retry button when error is present', async () => {
    const handleRetry = vi.fn();
    render(
      <RepositoryList
        isLoading={false}
        error="Failed to load repositories"
        onRetry={handleRetry}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load repositories');
    const retryBtn = screen.getByRole('button', { name: /try again/i });
    expect(retryBtn).toBeInTheDocument();

    await userEvent.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it('renders empty state when repositories array is empty', () => {
    render(<RepositoryList isLoading={false} repositories={[]} />);

    expect(screen.getByText('No repositories added yet')).toBeInTheDocument();
    expect(
      screen.getByText(/Import a public GitHub repository above/i)
    ).toBeInTheDocument();
  });

  it('renders repository cards and count badge when repositories are provided', () => {
    const mockRepositories = [
      {
        _id: '1',
        name: 'repo-one',
        fullName: 'org/repo-one',
        description: 'First test repository',
        htmlUrl: 'https://github.com/org/repo-one',
      },
      {
        _id: '2',
        name: 'repo-two',
        fullName: 'org/repo-two',
        description: 'Second test repository',
        htmlUrl: 'https://github.com/org/repo-two',
      },
    ];

    render(<RepositoryList isLoading={false} repositories={mockRepositories} />);

    expect(screen.getByRole('heading', { level: 2, name: /your repositories/i })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('org/repo-one')).toBeInTheDocument();
    expect(screen.getByText('org/repo-two')).toBeInTheDocument();
  });
});
