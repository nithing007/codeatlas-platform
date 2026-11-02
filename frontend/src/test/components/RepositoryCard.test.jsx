/**
 * RepositoryCard component tests.
 * Verifies rendering of repository details, badges, external link attributes,
 * and fallbacks for missing descriptions.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RepositoryCard } from '../../components/repositories/RepositoryCard.jsx';

describe('RepositoryCard', () => {
  const mockRepo = {
    _id: 'repo-1',
    name: 'codeatlas',
    fullName: 'codeatlas/platform',
    description: 'Code intelligence and drift detection platform',
    htmlUrl: 'https://github.com/codeatlas/platform',
    defaultBranch: 'main',
    visibility: 'public',
    language: 'JavaScript',
    stars: 120,
    forks: 15,
    createdAt: '2026-01-15T10:00:00Z',
  };

  it('renders repository fullName, description, and metadata badges', () => {
    render(<RepositoryCard repository={mockRepo} />);

    expect(screen.getByText('codeatlas/platform')).toBeInTheDocument();
    expect(
      screen.getByText('Code intelligence and drift detection platform')
    ).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('public')).toBeInTheDocument();
    expect(screen.getByText('JavaScript')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
  });

  it('renders external link with target="_blank" and rel="noopener noreferrer"', () => {
    render(<RepositoryCard repository={mockRepo} />);

    const link = screen.getByRole('link', { name: /codeatlas\/platform on GitHub/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://github.com/codeatlas/platform');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders fallback when description is missing', () => {
    const repoWithoutDesc = {
      ...mockRepo,
      description: null,
    };
    render(<RepositoryCard repository={repoWithoutDesc} />);

    expect(screen.getByText('No description provided.')).toBeInTheDocument();
  });

  it('returns null if repository is undefined', () => {
    const { container } = render(<RepositoryCard repository={null} />);
    expect(container.firstChild).toBeNull();
  });
});
