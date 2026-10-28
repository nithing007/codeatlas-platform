/**
 * AuthContext tests.
 * Tests: session initialization, authenticated/unauthenticated states,
 * 401 treated as unauthenticated, logout, setAuthenticated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '../../context/AuthContext.jsx';

// Mock the auth API
vi.mock('../../api/auth.js', () => ({
  getMe: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../../api/client.js', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
  default: {},
  buildBackendUrl: (p) => `http://localhost:5000/api${p}`,
}));

import { getMe, logout } from '../../api/auth.js';
import { ApiError } from '../../api/client.js';

// Simple consumer component
function TestConsumer() {
  const { user, sessionStatus, isAuthenticated, isLoading, logout: doLogout } = useAuth();
  return (
    <div>
      <span data-testid="status">{sessionStatus}</span>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="email">{user?.email ?? 'none'}</span>
      <button onClick={doLogout}>Logout</button>
    </div>
  );
}

function renderWithAuth() {
  return render(
    <AuthProvider>
      <TestConsumer />
    </AuthProvider>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts in loading state', () => {
    // Make getMe hang indefinitely
    getMe.mockImplementation(() => new Promise(() => {}));
    renderWithAuth();
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
  });

  it('sets authenticated state after successful getMe', async () => {
    getMe.mockResolvedValue({ success: true, user: { email: 'a@b.com', role: 'user' } });
    renderWithAuth();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      expect(screen.getByTestId('email')).toHaveTextContent('a@b.com');
    });
  });

  it('treats 401 from getMe as unauthenticated (not an error)', async () => {
    getMe.mockRejectedValue(new ApiError('Authentication required', 401));
    renderWithAuth();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      expect(screen.getByTestId('email')).toHaveTextContent('none');
    });
  });

  it('treats 500 from getMe as unauthenticated without crashing', async () => {
    getMe.mockRejectedValue(new ApiError('Internal Server Error', 500));
    renderWithAuth();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    });
  });

  it('clears user after logout', async () => {
    getMe.mockResolvedValue({ success: true, user: { email: 'a@b.com' } });
    logout.mockResolvedValue({ success: true });
    renderWithAuth();
    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('true'));

    await userEvent.click(screen.getByText('Logout'));
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      expect(screen.getByTestId('email')).toHaveTextContent('none');
    });
  });
});
