/**
 * ScanStatus component tests.
 * Verifies badge rendering, messages, results summary, and error display
 * for each scan status value.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScanStatus } from '../../components/scans/ScanStatus.jsx';

// Mock LoadingSpinner to keep tests focused on ScanStatus logic
vi.mock('../../components/ui/LoadingSpinner.jsx', () => ({
  LoadingSpinner: ({ label }) => <span data-testid="spinner">{label}</span>,
}));

describe('ScanStatus', () => {
  it('renders nothing when scan is null', () => {
    const { container } = render(<ScanStatus scan={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when scan is undefined', () => {
    const { container } = render(<ScanStatus scan={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  // ─── QUEUED ─────────────────────────────────────────────

  describe('QUEUED status', () => {
    const scan = { status: 'QUEUED', filesScanned: 0, findingsCount: 0 };

    it('renders "Queued" badge text', () => {
      render(<ScanStatus scan={scan} />);
      expect(screen.getByText('Queued')).toBeInTheDocument();
    });

    it('renders waiting message', () => {
      render(<ScanStatus scan={scan} />);
      expect(screen.getByText('Waiting for analysis worker.')).toBeInTheDocument();
    });

    it('does NOT render a spinner', () => {
      render(<ScanStatus scan={scan} />);
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    });

    it('has role="status" for live region', () => {
      render(<ScanStatus scan={scan} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  // ─── RUNNING ────────────────────────────────────────────

  describe('RUNNING status', () => {
    const scan = {
      status: 'RUNNING',
      filesScanned: 0,
      findingsCount: 0,
      startedAt: '2026-01-15T10:00:00Z',
    };

    it('renders "Running" badge text', () => {
      render(<ScanStatus scan={scan} />);
      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    it('renders a spinner', () => {
      render(<ScanStatus scan={scan} />);
      expect(screen.getByTestId('spinner')).toBeInTheDocument();
    });

    it('renders in-progress message', () => {
      render(<ScanStatus scan={scan} />);
      expect(
        screen.getByText('Repository analysis is in progress.')
      ).toBeInTheDocument();
    });

    it('has role="status" for live region', () => {
      render(<ScanStatus scan={scan} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  // ─── COMPLETED ──────────────────────────────────────────

  describe('COMPLETED status', () => {
    it('renders "Completed" badge text', () => {
      const scan = { status: 'COMPLETED', filesScanned: 42, findingsCount: 7 };
      render(<ScanStatus scan={scan} />);
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });

    it('renders files scanned count', () => {
      const scan = { status: 'COMPLETED', filesScanned: 42, findingsCount: 7 };
      render(<ScanStatus scan={scan} />);
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText(/files scanned/i)).toBeInTheDocument();
    });

    it('renders findings count when findingsCount > 0', () => {
      const scan = { status: 'COMPLETED', filesScanned: 42, findingsCount: 7 };
      render(<ScanStatus scan={scan} />);
      expect(screen.getByText('7')).toBeInTheDocument();
      expect(screen.getByText(/findings/i)).toBeInTheDocument();
    });

    it('renders "No drift findings" when findingsCount is 0', () => {
      const scan = { status: 'COMPLETED', filesScanned: 10, findingsCount: 0 };
      render(<ScanStatus scan={scan} />);
      expect(screen.getByText('No drift findings.')).toBeInTheDocument();
    });

    it('renders singular "file" for filesScanned === 1', () => {
      const scan = { status: 'COMPLETED', filesScanned: 1, findingsCount: 0 };
      render(<ScanStatus scan={scan} />);
      expect(screen.getByText(/1/)).toBeInTheDocument();
      expect(screen.getByText(/file scanned/i)).toBeInTheDocument();
    });

    it('renders singular "finding" for findingsCount === 1', () => {
      const scan = { status: 'COMPLETED', filesScanned: 5, findingsCount: 1 };
      render(<ScanStatus scan={scan} />);
      // "1 finding" (not "findings")
      expect(screen.getByText(/1/)).toBeInTheDocument();
      const findingEl = screen.getByText(/finding/);
      expect(findingEl.textContent).not.toMatch(/findings/);
    });

    it('does NOT render a spinner', () => {
      const scan = { status: 'COMPLETED', filesScanned: 10, findingsCount: 0 };
      render(<ScanStatus scan={scan} />);
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    });
  });

  // ─── FAILED ─────────────────────────────────────────────

  describe('FAILED status', () => {
    it('renders "Failed" badge text', () => {
      const scan = { status: 'FAILED', error: 'Analyzer timed out.' };
      render(<ScanStatus scan={scan} />);
      expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    it('renders the sanitized error message from backend', () => {
      const scan = { status: 'FAILED', error: 'Analyzer timed out.' };
      render(<ScanStatus scan={scan} />);
      expect(screen.getByText('Analyzer timed out.')).toBeInTheDocument();
    });

    it('renders fallback message when scan.error is absent', () => {
      const scan = { status: 'FAILED' };
      render(<ScanStatus scan={scan} />);
      expect(
        screen.getByText('The scan encountered an error. Please try again.')
      ).toBeInTheDocument();
    });

    it('does NOT render a spinner', () => {
      const scan = { status: 'FAILED', error: 'Analyzer timed out.' };
      render(<ScanStatus scan={scan} />);
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    });

    it('does NOT display raw stack traces or internal paths', () => {
      // Backend sanitizes errors before sending; we simply render what we receive.
      // This test ensures we don't add extra technical detail ourselves.
      const scan = {
        status: 'FAILED',
        error: 'Analysis failed due to a configuration error.',
      };
      render(<ScanStatus scan={scan} />);
      // The error shown is exactly the backend message — no "at Function..." traces
      expect(screen.getByText('Analysis failed due to a configuration error.')).toBeInTheDocument();
      expect(screen.queryByText(/at Function\./)).not.toBeInTheDocument();
    });
  });
});

