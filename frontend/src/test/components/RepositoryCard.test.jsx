/**
 * RepositoryCard component tests.
 * Verifies rendering of repository details, badges, external link attributes,
 * fallbacks for missing descriptions, the Start Analysis button, and Scan History toggle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepositoryCard } from '../../components/repositories/RepositoryCard.jsx';

// ─── Mocks ────────────────────────────────────────────────────

// Prevent useScanPolling from making real API calls in component tests
vi.mock('../../hooks/useScanPolling.js', () => ({
  useScanPolling: vi.fn(() => ({
    scan: null,
    isPolling: false,
    pollingError: null,
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
  })),
}));

// Mock ScanHistory sub-component to isolate RepositoryCard tests
vi.mock('../../components/scans/ScanHistory.jsx', () => ({
  ScanHistory: ({ repositoryId }) => (
    <div data-testid="scan-history">Scan History for {repositoryId}</div>
  ),
}));

// Stub out scan API
vi.mock('../../api/scans.js', () => ({
  createScan: vi.fn(),
  getScan: vi.fn(),
  getRepositoryScans: vi.fn(),
}));

// Stub out api client
vi.mock('../../api/client.js', () => ({
  default: {},
  ApiError: class ApiError extends Error {
    constructor(message, status, code = null) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  },
}));

import { useScanPolling } from '../../hooks/useScanPolling.js';

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

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no active scan
    useScanPolling.mockReturnValue({
      scan: null,
      isPolling: false,
      pollingError: null,
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
    });
  });

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

  it('renders Start Analysis button when no active scan', () => {
    render(<RepositoryCard repository={mockRepo} />);
    expect(screen.getByRole('button', { name: /start analysis/i })).toBeInTheDocument();
  });

  it('hides Start Analysis button while scan is RUNNING', () => {
    useScanPolling.mockReturnValue({
      scan: { status: 'RUNNING', filesScanned: 0, findingsCount: 0 },
      isPolling: true,
      pollingError: null,
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
    });

    render(<RepositoryCard repository={mockRepo} />);
    expect(screen.queryByRole('button', { name: /start analysis/i })).not.toBeInTheDocument();
  });

  it('hides Start Analysis button while scan is QUEUED', () => {
    useScanPolling.mockReturnValue({
      scan: { status: 'QUEUED', filesScanned: 0, findingsCount: 0 },
      isPolling: true,
      pollingError: null,
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
    });

    render(<RepositoryCard repository={mockRepo} />);
    expect(screen.queryByRole('button', { name: /start analysis/i })).not.toBeInTheDocument();
  });

  it('shows Start Analysis button after scan COMPLETES', () => {
    useScanPolling.mockReturnValue({
      scan: { status: 'COMPLETED', filesScanned: 10, findingsCount: 2 },
      isPolling: false,
      pollingError: null,
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
    });

    render(<RepositoryCard repository={mockRepo} />);
    expect(screen.getByRole('button', { name: /start analysis/i })).toBeInTheDocument();
  });

  it('renders Scan History button and toggles history section', async () => {
    render(<RepositoryCard repository={mockRepo} />);

    const historyBtn = screen.getByRole('button', { name: /scan history/i });
    expect(historyBtn).toBeInTheDocument();
    expect(historyBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('scan-history')).not.toBeInTheDocument();

    // Click to expand
    await userEvent.click(historyBtn);
    expect(screen.getByRole('button', { name: /hide history/i })).toBeInTheDocument();
    expect(screen.getByTestId('scan-history')).toBeInTheDocument();
    expect(screen.getByText('Scan History for repo-1')).toBeInTheDocument();

    // Click to collapse
    await userEvent.click(screen.getByRole('button', { name: /hide history/i }));
    expect(screen.getByRole('button', { name: /scan history/i })).toBeInTheDocument();
    expect(screen.queryByTestId('scan-history')).not.toBeInTheDocument();
  });
});
