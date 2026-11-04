/**
 * FactSummary component tests.
 * Verifies rendering of code and documentation facts, counts, and empty states.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FactSummary } from '../../../components/analysis/FactSummary.jsx';

const mockFacts = {
  code: {
    apiEndpoints: [
      { method: 'GET', path: '/api/users', file: 'routes/users.js', line: 10 },
      { method: 'POST', path: '/api/auth/login', file: 'routes/auth.js', line: 5 },
    ],
    envVars: [
      { name: 'DATABASE_URL', file: '.env.example', line: 1 },
    ],
    dependencies: [
      { name: 'express', version: '^4.18.0', type: 'production' },
      { name: 'vitest', version: '^1.0.0', type: 'development' },
    ],
    scripts: [
      { name: 'start', command: 'node server.js' },
      { name: 'test', command: 'vitest' },
    ],
  },
  documentation: {
    apiEndpoints: [
      { method: 'GET', path: '/api/users', file: 'README.md', line: 42 },
    ],
    envVars: [
      { name: 'DATABASE_URL', file: 'README.md', line: 20 },
    ],
  },
};

describe('FactSummary', () => {
  it('renders "Code Facts" and "Documentation Facts" column headings', () => {
    render(<FactSummary facts={mockFacts} />);
    expect(screen.getByText('Code Facts')).toBeInTheDocument();
    expect(screen.getByText('Documentation Facts')).toBeInTheDocument();
  });

  it('renders code API endpoints with method and path', () => {
    render(<FactSummary facts={mockFacts} />);
    expect(screen.getAllByText('GET').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('/api/auth/login')).toBeInTheDocument();
  });

  it('renders code environment variable names', () => {
    render(<FactSummary facts={mockFacts} />);
    // DATABASE_URL appears in both code and doc sections
    expect(screen.getAllByText('DATABASE_URL').length).toBeGreaterThanOrEqual(1);
  });

  it('renders dependency names and versions', () => {
    render(<FactSummary facts={mockFacts} />);
    expect(screen.getByText('express')).toBeInTheDocument();
    expect(screen.getByText('^4.18.0')).toBeInTheDocument();
  });

  it('renders script names', () => {
    render(<FactSummary facts={mockFacts} />);
    expect(screen.getByText('start')).toBeInTheDocument();
    expect(screen.getByText('node server.js')).toBeInTheDocument();
  });

  it('renders documentation API endpoints', () => {
    render(<FactSummary facts={mockFacts} />);
    // /api/users appears in both code and doc columns
    expect(screen.getAllByText('/api/users').length).toBeGreaterThanOrEqual(2);
  });

  it('shows empty notes when arrays are empty', () => {
    const emptyFacts = {
      code: { apiEndpoints: [], envVars: [], dependencies: [], scripts: [] },
      documentation: { apiEndpoints: [], envVars: [] },
    };
    render(<FactSummary facts={emptyFacts} />);
    expect(screen.getByText('No API endpoints detected in source code.')).toBeInTheDocument();
    expect(screen.getByText('No environment variables detected in source code.')).toBeInTheDocument();
    expect(screen.getByText('No dependencies detected.')).toBeInTheDocument();
    expect(screen.getByText('No scripts detected.')).toBeInTheDocument();
    expect(screen.getByText('No API endpoints detected in documentation.')).toBeInTheDocument();
    expect(screen.getByText('No environment variables detected in documentation.')).toBeInTheDocument();
  });

  it('renders gracefully when facts is undefined', () => {
    render(<FactSummary facts={undefined} />);
    expect(screen.getByText('Code Facts')).toBeInTheDocument();
  });

  it('shows zero count badge for empty groups', () => {
    const emptyFacts = {
      code: { apiEndpoints: [], envVars: [], dependencies: [], scripts: [] },
      documentation: { apiEndpoints: [], envVars: [] },
    };
    render(<FactSummary facts={emptyFacts} />);
    // Multiple "0" count badges should exist
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThan(0);
  });
});

