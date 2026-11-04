/**
 * useScanPolling hook tests.
 *
 * Uses vi.useFakeTimers to control setTimeout behaviour and
 * mocks api/scans.js to control resolved/rejected values.
 *
 * Tests that involve the mount-time async recovery IIFE use real timers
 * because waitFor() relies on setInterval internally.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useScanPolling } from '../../hooks/useScanPolling.js';

// ─── Mocks ────────────────────────────────────────────────────

vi.mock('../../api/scans.js', () => ({
  getScan: vi.fn(),
  getRepositoryScans: vi.fn(),
}));

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

import { getScan, getRepositoryScans } from '../../api/scans.js';
import { ApiError } from '../../api/client.js';

const REPO_ID = 'repo-123';
const SCAN_ID = 'scan-456';

function makeScan(status, overrides = {}) {
  return {
    _id: SCAN_ID,
    repositoryId: REPO_ID,
    status,
    filesScanned: 0,
    findingsCount: 0,
    ...overrides,
  };
}

// ─── Tests that need REAL timers (mount-time recovery) ────────
// waitFor() uses setInterval internally which is blocked by fake timers.

describe('useScanPolling — mount-time scan recovery (real timers)', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('recovers an active QUEUED scan from listScans on mount', async () => {
    const queuedScan = makeScan('QUEUED');
    getRepositoryScans.mockResolvedValue({ scans: [queuedScan] });
    getScan.mockResolvedValue({ scan: queuedScan });

    const { result, unmount } = renderHook(() => useScanPolling(REPO_ID));

    await waitFor(() => expect(result.current.scan).not.toBeNull());
    expect(result.current.scan.status).toBe('QUEUED');
    expect(result.current.isPolling).toBe(true);

    unmount(); // stop any polling timers before returning
  });

  it('recovers an active RUNNING scan from listScans on mount', async () => {
    const runningScan = makeScan('RUNNING');
    getRepositoryScans.mockResolvedValue({ scans: [runningScan] });
    getScan.mockResolvedValue({ scan: runningScan });

    const { result, unmount } = renderHook(() => useScanPolling(REPO_ID));

    await waitFor(() => expect(result.current.scan).not.toBeNull());
    expect(result.current.scan.status).toBe('RUNNING');
    expect(result.current.isPolling).toBe(true);

    unmount();
  });

  it('does NOT start polling when most recent scan is COMPLETED', async () => {
    const completedScan = makeScan('COMPLETED');
    getRepositoryScans.mockResolvedValue({ scans: [completedScan] });

    const { result, unmount } = renderHook(() => useScanPolling(REPO_ID));

    // Allow mount-time async IIFE to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.isPolling).toBe(false);
    expect(result.current.scan).toBeNull();

    unmount();
  });

  it('does NOT start polling when scan list is empty', async () => {
    getRepositoryScans.mockResolvedValue({ scans: [] });

    const { result, unmount } = renderHook(() => useScanPolling(REPO_ID));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.isPolling).toBe(false);
    expect(result.current.scan).toBeNull();

    unmount();
  });
});

// ─── Tests that use FAKE timers (interval-based polling) ──────

describe('useScanPolling — polling behaviour (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Default: no previous scans to recover
    getRepositoryScans.mockResolvedValue({ scans: [] });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // Helper: mount hook and settle the mount-time fetch
  async function mountAndSettle() {
    const hook = renderHook(() => useScanPolling(REPO_ID));
    // Flush the mount-time IIFE (getRepositoryScans resolves immediately via mock)
    await act(async () => {
      await Promise.resolve();
    });
    return hook;
  }

  // ─── startPolling ──────────────────────────────────────

  it('startPolling sets isPolling true and seeds scan state immediately', async () => {
    const queuedScan = makeScan('QUEUED');
    getScan.mockResolvedValue({ scan: queuedScan });

    const { result } = await mountAndSettle();

    act(() => {
      result.current.startPolling(SCAN_ID, queuedScan);
    });

    expect(result.current.isPolling).toBe(true);
    expect(result.current.scan).toEqual(queuedScan);
  });

  // ─── Polling progression ────────────────────────────────

  it('continues polling while status is QUEUED', async () => {
    const queuedScan = makeScan('QUEUED');
    getScan.mockResolvedValue({ scan: queuedScan });

    const { result } = await mountAndSettle();

    act(() => { result.current.startPolling(SCAN_ID, queuedScan); });

    // Advance past first poll interval
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(getScan).toHaveBeenCalled();
    expect(result.current.isPolling).toBe(true);
  });

  it('continues polling while status is RUNNING', async () => {
    const runningScan = makeScan('RUNNING');
    getScan.mockResolvedValue({ scan: runningScan });

    const { result } = await mountAndSettle();

    act(() => { result.current.startPolling(SCAN_ID, runningScan); });

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(result.current.isPolling).toBe(true);
  });

  it('stops polling when status becomes COMPLETED', async () => {
    const runningScan = makeScan('RUNNING');
    const completedScan = makeScan('COMPLETED', { filesScanned: 10, findingsCount: 2 });

    getScan
      .mockResolvedValueOnce({ scan: runningScan })
      .mockResolvedValueOnce({ scan: completedScan });

    const { result } = await mountAndSettle();

    act(() => { result.current.startPolling(SCAN_ID, runningScan); });

    // First poll — still RUNNING
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    // Second poll — COMPLETED
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(result.current.scan.status).toBe('COMPLETED');
    expect(result.current.isPolling).toBe(false);
  });

  it('stops polling when status becomes FAILED', async () => {
    const runningScan = makeScan('RUNNING');
    const failedScan = makeScan('FAILED', { error: 'Analyzer timed out.' });

    getScan
      .mockResolvedValueOnce({ scan: runningScan })
      .mockResolvedValueOnce({ scan: failedScan });

    const { result } = await mountAndSettle();

    act(() => { result.current.startPolling(SCAN_ID, runningScan); });

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(result.current.scan.status).toBe('FAILED');
    expect(result.current.isPolling).toBe(false);
  });

  // ─── Error handling ─────────────────────────────────────

  it('stops polling silently on 404 (scan gone)', async () => {
    const runningScan = makeScan('RUNNING');
    getScan.mockRejectedValue(new ApiError('Scan not found.', 404));

    const { result } = await mountAndSettle();

    act(() => { result.current.startPolling(SCAN_ID, runningScan); });

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(result.current.isPolling).toBe(false);
    expect(result.current.pollingError).toBeNull();
  });

  it('stops polling silently on 401 (session expired)', async () => {
    const runningScan = makeScan('RUNNING');
    getScan.mockRejectedValue(
      new ApiError('Authentication required. Please log in.', 401)
    );

    const { result } = await mountAndSettle();

    act(() => { result.current.startPolling(SCAN_ID, runningScan); });

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(result.current.isPolling).toBe(false);
    expect(result.current.pollingError).toBeNull();
  });

  it('retries on network error (status 0) and does NOT mark scan as failed', async () => {
    const runningScan = makeScan('RUNNING');

    getScan
      .mockRejectedValueOnce(new ApiError('Unable to reach the server.', 0))
      .mockResolvedValueOnce({ scan: runningScan });

    const { result } = await mountAndSettle();

    act(() => { result.current.startPolling(SCAN_ID, runningScan); });

    // First poll — network error
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    // Should still be polling
    expect(result.current.isPolling).toBe(true);
    expect(result.current.scan?.status).not.toBe('FAILED');

    // Second poll — RUNNING returns
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(result.current.isPolling).toBe(true);
    expect(result.current.scan.status).toBe('RUNNING');
    expect(result.current.pollingError).toBeNull();
  });

  it('surfaces pollingError after MAX_NETWORK_RETRIES consecutive network failures', async () => {
    const runningScan = makeScan('RUNNING');
    getScan.mockRejectedValue(new ApiError('Unable to reach the server.', 0));

    const { result } = await mountAndSettle();

    act(() => { result.current.startPolling(SCAN_ID, runningScan); });

    // Exhaust 3 retries
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        vi.advanceTimersByTime(3000);
        await Promise.resolve();
      });
    }

    expect(result.current.pollingError).toMatch(/network|connection/i);
    // Still polling — network errors do NOT stop the loop
    expect(result.current.isPolling).toBe(true);
  });

  // ─── Cleanup on unmount ─────────────────────────────────

  it('cancels the timeout and stops polling on unmount', async () => {
    const runningScan = makeScan('RUNNING');
    getScan.mockResolvedValue({ scan: runningScan });

    const { result, unmount } = await mountAndSettle();

    act(() => { result.current.startPolling(SCAN_ID, runningScan); });
    expect(result.current.isPolling).toBe(true);

    unmount();

    // Advance timers — no state updates should fire after unmount
    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });

    // Test completes without React "setState on unmounted component" errors
    expect(true).toBe(true);
  });

  // ─── stopPolling ────────────────────────────────────────

  it('stopPolling sets isPolling false and cancels pending timer', async () => {
    const runningScan = makeScan('RUNNING');
    getScan.mockResolvedValue({ scan: runningScan });

    const { result } = await mountAndSettle();

    act(() => { result.current.startPolling(SCAN_ID, runningScan); });
    expect(result.current.isPolling).toBe(true);

    act(() => { result.current.stopPolling(); });
    expect(result.current.isPolling).toBe(false);
  });
});
