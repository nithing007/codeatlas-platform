/**
 * useScanPolling — polls a scan's status at a fixed interval.
 *
 * Usage:
 *   const { scan, isPolling, pollingError, startPolling, stopPolling } =
 *     useScanPolling(repositoryId);
 *
 * On mount, if no initialScanId is provided, the hook fetches the most recent
 * scan for the repository and resumes polling if it is QUEUED or RUNNING.
 *
 * Polling stops automatically when:
 *   - Status becomes COMPLETED or FAILED
 *   - A 404 (scan gone) or 401 (session expired) error is received
 *
 * Transient network errors (ApiError with status 0) are logged and retried.
 * Consecutive network failures beyond the threshold set pollingError, but do
 * NOT mark the scan as failed — that is the backend's responsibility.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getScan, getRepositoryScans } from '../api/scans.js';
import { ApiError } from '../api/client.js';

const POLL_INTERVAL_MS = 3000;
const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED']);
const STOP_ON_STATUS_CODES = new Set([401, 404]);
// Number of consecutive network failures before surfacing pollingError
const MAX_NETWORK_RETRIES = 3;

/**
 * @param {string}  repositoryId        The repository _id to poll scans for.
 * @param {string}  [initialScanId]     If known, start polling this scan immediately.
 */
export function useScanPolling(repositoryId, initialScanId) {
  const [scan, setScan] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [pollingError, setPollingError] = useState(null);

  // Refs — updated synchronously, never trigger re-renders on their own
  const timeoutRef = useRef(null);
  const abortRef = useRef(null);
  const scanIdRef = useRef(initialScanId || null);
  const networkFailuresRef = useRef(0);
  const unmountedRef = useRef(false);

  /** Cancel any pending timer and in-flight request. */
  const cancelPending = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  /** Fully stop polling and clear all state related to it. */
  const stopPolling = useCallback(() => {
    cancelPending();
    if (!unmountedRef.current) {
      setIsPolling(false);
    }
  }, [cancelPending]);

  /**
   * Schedule one poll tick after POLL_INTERVAL_MS ms.
   * Uses recursive setTimeout to avoid overlapping requests.
   */
  const schedulePoll = useCallback(
    (currentScanId) => {
      timeoutRef.current = setTimeout(async () => {
        if (unmountedRef.current) return;

        const controller = new AbortController();
        abortRef.current = controller;

        try {
          const data = await getScan(repositoryId, currentScanId, controller.signal);

          if (unmountedRef.current) return;

          networkFailuresRef.current = 0;
          const updatedScan = data.scan;
          setScan(updatedScan);
          setPollingError(null);

          if (TERMINAL_STATUSES.has(updatedScan.status)) {
            stopPolling();
          } else {
            schedulePoll(currentScanId);
          }
        } catch (err) {
          if (unmountedRef.current) return;
          if (err.name === 'AbortError') return;

          if (err instanceof ApiError) {
            if (STOP_ON_STATUS_CODES.has(err.status)) {
              // Scan gone (404) or session expired (401) — stop silently
              stopPolling();
              return;
            }

            if (err.status === 0) {
              // Network error — count retries
              networkFailuresRef.current += 1;
              if (networkFailuresRef.current >= MAX_NETWORK_RETRIES) {
                setPollingError('Network connection lost. Retrying…');
              }
              // Always retry, do NOT mark scan as failed
              schedulePoll(currentScanId);
              return;
            }
          }

          // Other unexpected errors — surface and stop
          setPollingError(err.message || 'Scan status check failed.');
          stopPolling();
        }
      }, POLL_INTERVAL_MS);
    },
    [repositoryId, stopPolling]
  );

  /**
   * Begin polling a known scan ID immediately.
   * @param {string} scanId
   * @param {object} [initialScanObject]  Optionally seed the scan state immediately.
   */
  const startPolling = useCallback(
    (scanId, initialScanObject) => {
      cancelPending();
      scanIdRef.current = scanId;
      networkFailuresRef.current = 0;

      if (!unmountedRef.current) {
        setPollingError(null);
        setIsPolling(true);
        if (initialScanObject) {
          setScan(initialScanObject);
        }
      }

      schedulePoll(scanId);
    },
    [cancelPending, schedulePoll]
  );

  /**
   * On mount, attempt to recover an active scan from the backend.
   * If initialScanId was provided, go straight to polling that scan.
   * Otherwise, fetch the most recent scan and resume if it's active.
   */
  useEffect(() => {
    unmountedRef.current = false;

    if (!repositoryId) return;

    if (scanIdRef.current) {
      // We already know which scan to poll — start immediately
      startPolling(scanIdRef.current);
      return;
    }

    // Try to recover an active scan from the backend
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        const data = await getRepositoryScans(
          repositoryId,
          { page: 1, limit: 1 },
          controller.signal
        );

        if (unmountedRef.current) return;

        const newest = data.scans?.[0];
        if (newest && !TERMINAL_STATUSES.has(newest.status)) {
          startPolling(newest._id, newest);
        }
      } catch (err) {
        if (unmountedRef.current) return;
        if (err.name === 'AbortError') return;
        // Not a critical failure — the user just won't auto-resume polling
        // They can still trigger a new scan via the Start Analysis button
      }
    })();

    return () => {
      unmountedRef.current = true;
      cancelPending();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositoryId]);

  return { scan, isPolling, pollingError, startPolling, stopPolling };
}

