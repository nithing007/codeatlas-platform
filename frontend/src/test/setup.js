/**
 * Test setup — extends Vitest's expect with @testing-library/jest-dom matchers
 * and cleans up after each test.
 */
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// Mock window.location for redirect tests
Object.defineProperty(window, 'location', {
  value: {
    href: '',
    assign: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
    origin: 'http://localhost:5173',
    pathname: '/',
    search: '',
    hash: '',
  },
  writable: true,
});

