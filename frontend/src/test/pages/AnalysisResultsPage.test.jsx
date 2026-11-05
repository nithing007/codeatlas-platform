/**
 * AnalysisResultsPage component tests.
 * Verifies loading state, successful render, error handling, retry, and routing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AnalysisResultsPage } from '../../pages/AnalysisResultsPage.jsx';

// ─── Mocks ────────────────────────────────────────────────────

vi.mock('../../api/analysis.js', () => ({
  getScanAnalysis: vi.fn(),
}));

vi.mock('../../components/ui/LoadingSpinner.jsx', () => ({
  LoadingSpinner: ({ label }) => <span role="status">{label || 'Loading…'}</span>,
}));

vi.mock('../../components/analysis/AnalysisOverview.jsx', () => ({
  AnalysisOverview: ({ result }) => (
    <div data-testid="analysis-overview">
      {result?.analyzerVersion && <span>v{result.analyzerVersion}</span>}
    </div>
  ),
}));

vi.mock('../../components/analysis/FactSummary.jsx', () => ({
  FactSummary: () => <div data-testid="fact-summary" />,
}));

vi.mock('../../components/analysis/AnalysisWarnings.jsx', () => ({
  AnalysisWarnings: ({ warnings }) => (
    <div data-testid="analysis-warnings">{warnings?.length ?? 0} warnings</div>
  ),
}));

vi.mock('../../components/analysis/DriftSummary.jsx', () => ({
  DriftSummary: () => <div data-testid="drift-summary" />,
}));

vi.mock('../../components/analysis/DriftFindingsExplorer.jsx', () => ({
  DriftFindingsExplorer: ({ findings }) => (
    <div data-testid="drift-findings-explorer">
      {findings?.length ?? 0} findings
    </div>
  ),
}));

import { getScanAnalysis } from '../../api/analysis.js';

const REPO_ID = 'repo-123';
const SCAN_ID = 'scan-456';

const mockAnalysis = {
  _id: 'result-1',
  scanId: SCAN_ID,
  repositoryId: REPO_ID,
  analyzerVersion: '1.2.3',
  commitSha: 'abcdef1234567890',
  branch: 'main',
  fileCounts: { total: 42, source: 30, documentation: 5, configuration: 7 },
  facts: { code: {}, documentation: {} },
  drift: { summary: { total: 2, high: 1, medium: 1, low: 0 } },
  warnings: ['A warning'],
  createdAt: '2026-11-04T10:00:00.000Z',
};

function renderPage(repoId = REPO_ID, scanId = SCAN_ID) {
  return render(
    <MemoryRouter initialEntries={[`/repositories/${repoId}/scans/${scanId}/analysis`]}>
      <Routes>
        <Route
          path="/repositories/:repositoryId/scans/:scanId/analysis"
          element={<AnalysisResultsPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('AnalysisResultsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner on mount', () => {
    getScanAnalysis.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/loading analysis results/i)).toBeInTheDocument();
  });

  it('renders analysis components on success', async () => {
    getScanAnalysis.mockResolvedValueOnce({ success: true, analysis: mockAnalysis });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('analysis-overview')).toBeInTheDocument();
    });
    expect(screen.getByTestId('fact-summary')).toBeInTheDocument();
    expect(screen.getByTestId('drift-summary')).toBeInTheDocument();
    expect(screen.getByTestId('analysis-warnings')).toBeInTheDocument();
  });

  it('shows error alert on API failure', async () => {
    getScanAnalysis.mockRejectedValueOnce(new Error('Analysis not found.'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Analysis not found.');
  });

  it('renders retry button on error', async () => {
    getScanAnalysis.mockRejectedValueOnce(new Error('Server error.'));
    renderPage();

    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
  });

  it('retries the fetch when Retry is clicked', async () => {
    getScanAnalysis
      .mockRejectedValueOnce(new Error('Temporary failure.'))
      .mockResolvedValueOnce({ success: true, analysis: mockAnalysis });

    renderPage();

    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    await userEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByTestId('analysis-overview')).toBeInTheDocument();
    });
    expect(getScanAnalysis).toHaveBeenCalledTimes(2);
  });

  it('shows 400 SCAN_NOT_COMPLETED error message', async () => {
    const err = new Error('Analysis is not ready. Scan is currently RUNNING.');
    err.status = 400;
    err.code = 'SCAN_NOT_COMPLETED';
    getScanAnalysis.mockRejectedValueOnce(err);

    renderPage();

    expect(
      await screen.findByText(/analysis is not ready/i)
    ).toBeInTheDocument();
  });

  it('renders breadcrumb navigation', async () => {
    getScanAnalysis.mockResolvedValueOnce({ success: true, analysis: mockAnalysis });
    renderPage();

    const breadcrumb = await screen.findByRole('navigation', { name: /breadcrumb/i });
    expect(breadcrumb).toBeInTheDocument();
    expect(breadcrumb).toHaveTextContent('Repositories');
    expect(breadcrumb).toHaveTextContent('Repository');
    expect(breadcrumb).toHaveTextContent('Analysis Results');
  });

  it('renders "Analysis Results" page title', async () => {
    getScanAnalysis.mockResolvedValueOnce({ success: true, analysis: mockAnalysis });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /analysis results/i })).toBeInTheDocument();
    });
  });

  it('calls getScanAnalysis with correct repositoryId and scanId from URL', async () => {
    getScanAnalysis.mockResolvedValueOnce({ success: true, analysis: mockAnalysis });
    renderPage('my-repo', 'my-scan');

    await waitFor(() => {
      expect(getScanAnalysis).toHaveBeenCalledWith(
        'my-repo',
        'my-scan',
        expect.any(AbortSignal)
      );
    });
  });

  it('renders warnings section when warnings are present', async () => {
    getScanAnalysis.mockResolvedValueOnce({ success: true, analysis: mockAnalysis });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('analysis-warnings')).toBeInTheDocument();
    });
    expect(screen.getByText('1 warnings')).toBeInTheDocument();
  });

  it('renders drift findings explorer in the dashboard view', async () => {
    getScanAnalysis.mockResolvedValueOnce({ success: true, analysis: mockAnalysis });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('drift-findings-explorer')).toBeInTheDocument();
    });
  });

  it('renders dedicated findings view with extended breadcrumbs and back link', async () => {
    getScanAnalysis.mockResolvedValueOnce({ success: true, analysis: mockAnalysis });
    render(
      <MemoryRouter initialEntries={[`/repositories/${REPO_ID}/scans/${SCAN_ID}/analysis/findings`]}>
        <Routes>
          <Route
            path="/repositories/:repositoryId/scans/:scanId/analysis/findings"
            element={<AnalysisResultsPage isFindingsView />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /drift findings/i })).toBeInTheDocument();
    });

    const breadcrumb = screen.getByRole('navigation', { name: /breadcrumb/i });
    expect(breadcrumb).toHaveTextContent('Analysis Results');
    expect(breadcrumb).toHaveTextContent('Drift Findings');

    expect(screen.getByRole('link', { name: /back to overview/i })).toBeInTheDocument();
    expect(screen.getByTestId('drift-findings-explorer')).toBeInTheDocument();
  });
});

