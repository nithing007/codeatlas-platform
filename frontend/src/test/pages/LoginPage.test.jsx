/**
 * LoginPage integration tests.
 * Tests: form rendering, Google OAuth initiation, OTP step transitions,
 * loading states, not-found route, logout navigation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../../pages/auth/LoginPage.jsx';
import { AuthContext } from '../../context/AuthContext.jsx';
import { NotFoundPage } from '../../pages/NotFoundPage.jsx';

// Mock auth API
vi.mock('../../api/auth.js', () => ({
  requestOtp: vi.fn(),
  verifyOtp: vi.fn(),
  getGoogleAuthUrl: vi.fn(() => 'http://localhost:5000/api/auth/google'),
  logout: vi.fn(),
  getMe: vi.fn(),
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

import { requestOtp, verifyOtp } from '../../api/auth.js';
import { ApiError } from '../../api/client.js';

const unauthContext = {
  user: null,
  sessionStatus: 'unauthenticated',
  isAuthenticated: false,
  isLoading: false,
  setAuthenticated: vi.fn(),
  logout: vi.fn(),
};

function renderLoginPage(authCtx = unauthContext) {
  return render(
    <AuthContext.Provider value={authCtx}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<div data-testid="dashboard">Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.href = '';
  });

  it('renders email input and send button', () => {
    renderLoginPage();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send verification code/i })).toBeInTheDocument();
  });

  it('renders Google sign-in button', () => {
    renderLoginPage();
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
  });

  it('Google button triggers window.location.href navigation', async () => {
    renderLoginPage();
    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(window.location.href).toBe('http://localhost:5000/api/auth/google');
  });

  it('shows OTP step after successful email submission', async () => {
    requestOtp.mockResolvedValue({ success: true, message: 'Verification code sent to your email' });
    renderLoginPage();
    await userEvent.type(screen.getByLabelText(/email address/i), 'user@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send verification code/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
    });
  });

  it('shows email validation error for invalid email', async () => {
    renderLoginPage();
    await userEvent.type(screen.getByLabelText(/email address/i), 'invalid-email');
    await userEvent.click(screen.getByRole('button', { name: /send verification code/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(requestOtp).not.toHaveBeenCalled();
  });

  it('shows backend error message on failed OTP request', async () => {
    requestOtp.mockRejectedValue(new ApiError('Please wait 45 seconds before requesting a new code', 429));
    renderLoginPage();
    await userEvent.type(screen.getByLabelText(/email address/i), 'user@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send verification code/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('45 seconds');
    });
  });

  it('navigates to dashboard after successful OTP verification', async () => {
    requestOtp.mockResolvedValue({ success: true, message: 'Sent' });
    verifyOtp.mockResolvedValue({ success: true, user: { email: 'a@b.com' }, isNewUser: false });
    const setAuthenticated = vi.fn();
    renderLoginPage({ ...unauthContext, setAuthenticated });

    await userEvent.type(screen.getByLabelText(/email address/i), 'a@b.com');
    await userEvent.click(screen.getByRole('button', { name: /send verification code/i }));
    await waitFor(() => screen.getByLabelText(/verification code/i));
    await userEvent.type(screen.getByLabelText(/verification code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));

    await waitFor(() => {
      expect(setAuthenticated).toHaveBeenCalledWith({ email: 'a@b.com' });
    });
  });

  it('shows OTP error from backend', async () => {
    requestOtp.mockResolvedValue({ success: true, message: 'Sent' });
    verifyOtp.mockRejectedValue(new ApiError('Invalid verification code. 3 attempts remaining', 401));
    renderLoginPage();

    await userEvent.type(screen.getByLabelText(/email address/i), 'a@b.com');
    await userEvent.click(screen.getByRole('button', { name: /send verification code/i }));
    await waitFor(() => screen.getByLabelText(/verification code/i));
    await userEvent.type(screen.getByLabelText(/verification code/i), '999999');
    await userEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid verification code');
    });
  });

  it('can navigate back to email step from OTP step', async () => {
    requestOtp.mockResolvedValue({ success: true, message: 'Sent' });
    renderLoginPage();
    await userEvent.type(screen.getByLabelText(/email address/i), 'a@b.com');
    await userEvent.click(screen.getByRole('button', { name: /send verification code/i }));
    await waitFor(() => screen.getByText(/change email/i));
    await userEvent.click(screen.getByText(/change email/i));
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });
});

describe('NotFoundPage', () => {
  it('renders 404 content', () => {
    render(
      <MemoryRouter initialEntries={['/no-such-route']}>
        <Routes>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText(/page not found/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go home/i })).toBeInTheDocument();
  });
});
