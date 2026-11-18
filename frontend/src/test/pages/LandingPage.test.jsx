/**
 * LandingPage component tests.
 * Verifies hero section, problem/solution, core capabilities, workflow steps,
 * CTAs for authenticated/unauthenticated users, and footer.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LandingPage } from '../../pages/LandingPage.jsx';
import { AuthContext } from '../../context/AuthContext.jsx';

const unauthContext = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
};

const authContext = {
  user: { name: 'Ada Lovelace', email: 'ada@example.com' },
  isAuthenticated: true,
  isLoading: false,
};

function renderLandingPage(authValue = unauthContext) {
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={['/']}>
        <LandingPage />
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

describe('LandingPage', () => {
  it('renders hero headline and drift detection badge', () => {
    renderLandingPage();
    expect(screen.getAllByText(/repository intelligence & documentation drift detection/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/bridge the gap between your/i);
  });

  it('renders unauthenticated CTAs (Get started free and Sign in)', () => {
    renderLandingPage(unauthContext);
    expect(screen.getAllByRole('button', { name: /get started free/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /^sign in$/i }).length).toBeGreaterThan(0);
  });

  it('renders authenticated CTA (Go to Dashboard) when user is logged in', () => {
    renderLandingPage(authContext);
    expect(screen.getByRole('button', { name: /go to dashboard/i })).toBeInTheDocument();
  });

  it('renders problem and solution section', () => {
    renderLandingPage();
    expect(screen.getByText(/the documentation drift problem/i)).toBeInTheDocument();
    expect(screen.getByText(/how codeatlas solves it/i)).toBeInTheDocument();
    expect(screen.getByText(/undocumented api endpoints:/i)).toBeInTheDocument();
  });

  it('renders all 8 core implemented capabilities', () => {
    renderLandingPage();
    expect(screen.getByRole('heading', { level: 3, name: 'Repository Intelligence' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Static Code Analysis' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Documentation Drift Detection' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Environment Variable Analysis' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'API Documentation Analysis' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Asynchronous Scanning' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Persistent Scan Processing' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Findings Exploration' })).toBeInTheDocument();
  });

  it('renders 5-step workflow', () => {
    renderLandingPage();
    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Import Repository' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Queue Analysis' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Extract Facts' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Detect Drift' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Review Findings' })).toBeInTheDocument();
  });

  it('renders footer with brand, navigation, and architecture info', () => {
    renderLandingPage();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByText(/persistent queue & analyzer operational/i)).toBeInTheDocument();
    expect(screen.getByText(/react 19 \+ vite/i)).toBeInTheDocument();
  });
});
