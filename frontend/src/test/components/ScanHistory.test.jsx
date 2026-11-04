/**
 * ScanHistory component tests.
 * Verifies loading, empty, error, scan rendering, pagination, retry actions,
 * and "View Results" link for completed scans (Phase 6C).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ScanHistory } from '../../components/scans/ScanHistory.jsx';

// ─── Mocks ────────────────────────────────────────────────────

vi.mock('../../api/scans.js', () => ({
  getRepositoryScans: vi.fn(),
}));

vi.mock('../../components/ui/LoadingSpinner.jsx', () => ({
  LoadingSpinner: ({ label }) => <span data-testid="spinner">{label}</span>,
}));

import { getRepositoryScans } from '../../api/scans.js';

const REPO_ID = 'repo-123';

function renderScanHistory(props) {
  return render(
    <MemoryRouter>
      <ScanHistory repositoryId={REPO_ID} {...props} />
    </MemoryRouter>
  );
}

const mockScans = [
  {
    _id: 'scan-1',
    repositoryId: REPO_ID,
    status: 'COMPLETED',
    branch: 'main',
    commitSha: 'abcdef1234567890',
    startedAt: '2026-11-04T08:00:00.000Z',
    completedAt: '2026-11-04T08:00:15.000Z',
    filesScanned: 24,
    findingsCount: 3,
    createdAt: '2026-11-04T08:00:00.000Z',
  },
  {
    _id: 'scan-2',
    repositoryId: REPO_ID,
    status: 'FAILED',
    branch: 'feature-drift',
    commitSha: '9876543210fedcba',
    startedAt: '2026-11-04T07:30:00.000Z',
    completedAt: '2026-11-04T07:30:05.000Z',
    error: 'Repository or branch not found on GitHub.',
    createdAt: '2026-11-04T07:30:00.000Z',
  },
  {
    _id: 'scan-3',
    repositoryId: REPO_ID,
    status: 'RUNNING',
    branch: 'main',
    commitSha: '1122334455667788',
    startedAt: '2026-11-04T07:00:00.000Z',
    completedAt: null,
    createdAt: '2026-11-04T07:00:00.000Z',
  },
];

describe('ScanHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null if repositoryId is missing', () => {
    const { container } = render(
      <MemoryRouter>
        <ScanHistory repositoryId={null} />
      </MemoryRouter>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders loading spinner while fetching scans', () => {
    getRepositoryScans.mockReturnValue(new Promise(() => {})); // never resolves
    renderScanHistory();

    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it('renders empty state when scan list is empty', async () => {
    getRepositoryScans.mockResolvedValue({ scans: [], total: 0, totalPages: 1 });
    renderScanHistory();

    await waitFor(() => {
      expect(screen.getByText('No previous scans yet.')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/run an analysis to inspect repository health/i)
    ).toBeInTheDocument();
  });

  it('renders "Run First Scan" button in empty state when onStartAnalysis provided', async () => {
    const handleStart = vi.fn();
    getRepositoryScans.mockResolvedValue({ scans: [], total: 0, totalPages: 1 });

    renderScanHistory({ onStartAnalysis: handleStart, canStartAnalysis: true });

    const runBtn = await screen.findByRole('button', { name: /run first scan/i });
    expect(runBtn).toBeInTheDocument();

    await userEvent.click(runBtn);
    expect(handleStart).toHaveBeenCalledTimes(1);
  });

  it('renders error message and retry button on fetch failure', async () => {
    getRepositoryScans.mockRejectedValue(new Error('Network error. Failed to load.'));
    renderScanHistory();

    expect(
      await screen.findByText('Network error. Failed to load.')
    ).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
  });

  it('retries fetching when Retry button is clicked', async () => {
    getRepositoryScans
      .mockRejectedValueOnce(new Error('Server error.'))
      .mockResolvedValueOnce({ scans: mockScans, total: 3, totalPages: 1 });

    renderScanHistory();

    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    await userEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('renders scan history list with badges, shortened SHAs, duration, and findings', async () => {
    getRepositoryScans.mockResolvedValue({
      scans: mockScans,
      total: 3,
      totalPages: 1,
    });

    renderScanHistory();

    // Status badges
    expect(await screen.findByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getAllByText('Running').length).toBeGreaterThanOrEqual(1);

    // Shortened commit SHAs
    expect(screen.getByText('#abcdef1')).toBeInTheDocument();
    expect(screen.getByText('#9876543')).toBeInTheDocument();

    // Duration (15s for scan-1, 5s for scan-2)
    expect(screen.getByText('15s')).toBeInTheDocument();
    expect(screen.getByText('5s')).toBeInTheDocument();

    // Files and drift findings for COMPLETED scan
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText(/files/i)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/drift findings/i)).toBeInTheDocument();

    // Error message for FAILED scan
    expect(
      screen.getByText('Repository or branch not found on GitHub.')
    ).toBeInTheDocument();
  });

  it('renders pagination controls when totalPages > 1', async () => {
    getRepositoryScans.mockResolvedValue({
      scans: [mockScans[0]],
      total: 10,
      totalPages: 2,
    });

    renderScanHistory();

    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    const prevBtn = screen.getByRole('button', { name: /previous page/i });
    const nextBtn = screen.getByRole('button', { name: /next page/i });

    expect(prevBtn).toBeDisabled();
    expect(nextBtn).toBeEnabled();
  });

  it('fetches next page when Next button is clicked', async () => {
    getRepositoryScans
      .mockResolvedValueOnce({
        scans: [mockScans[0]],
        total: 10,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        scans: [mockScans[1]],
        total: 10,
        totalPages: 2,
      });

    renderScanHistory();

    const nextBtn = await screen.findByRole('button', { name: /next page/i });
    await userEvent.click(nextBtn);

    await waitFor(() => {
      expect(getRepositoryScans).toHaveBeenCalledWith(
        REPO_ID,
        { page: 2, limit: 5 },
        expect.any(AbortSignal)
      );
    });
  });

  it('does not render pagination when totalPages is 1', async () => {
    getRepositoryScans.mockResolvedValue({
      scans: [mockScans[0]],
      total: 1,
      totalPages: 1,
    });

    renderScanHistory();

    await screen.findByText('Completed');
    expect(screen.queryByRole('navigation', { name: /pagination/i })).not.toBeInTheDocument();
  });

  it('renders "View Results" link for COMPLETED scans', async () => {
    getRepositoryScans.mockResolvedValue({
      scans: mockScans,
      total: 3,
      totalPages: 1,
    });

    renderScanHistory();

    await screen.findByText('Completed');

    const link = screen.getByRole('link', { name: /view results/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      'href',
      `/repositories/${REPO_ID}/scans/scan-1/analysis`
    );
  });

  it('does not render "View Results" link for FAILED scans', async () => {
    getRepositoryScans.mockResolvedValue({
      scans: [mockScans[1]], // FAILED
      total: 1,
      totalPages: 1,
    });

    renderScanHistory();

    await screen.findByText('Failed');
    expect(screen.queryByRole('link', { name: /view results/i })).not.toBeInTheDocument();
  });

  it('does not render "View Results" link for RUNNING scans', async () => {
    getRepositoryScans.mockResolvedValue({
      scans: [mockScans[2]], // RUNNING
      total: 1,
      totalPages: 1,
    });

    renderScanHistory();

    await waitFor(() => {
      expect(screen.getAllByText('Running').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByRole('link', { name: /view results/i })).not.toBeInTheDocument();
  });
});
