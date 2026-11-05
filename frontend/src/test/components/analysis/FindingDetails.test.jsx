/**
 * FindingDetails component tests.
 * Verifies rendering of explanation, resource, code evidence, doc evidence,
 * missing evidence states, and security notice.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FindingDetails } from '../../../components/analysis/FindingDetails.jsx';

const mockApiFinding = {
  type: 'UNDOCUMENTED_API',
  severity: 'HIGH',
  title: 'Undocumented API endpoint',
  message: 'POST /api/users exists in source code but was not found in repository documentation.',
  resource: { method: 'POST', path: '/api/users' },
  codeEvidence: {
    file: 'src/routes/users.js',
    line: 25,
    prefixResolved: true,
  },
  documentationEvidence: null,
};

const mockEnvFinding = {
  type: 'OBSOLETE_ENVIRONMENT_VARIABLE',
  severity: 'LOW',
  title: 'Documented environment variable not found in source code',
  message: 'Environment variable "REDIS_PORT" is documented but was not found in analyzed source code.',
  resource: { name: 'REDIS_PORT' },
  codeEvidence: null,
  documentationEvidence: {
    source: 'README.md',
    line: 88,
    fromTable: true,
  },
};

describe('FindingDetails', () => {
  it('returns null if finding is null or undefined', () => {
    const { container: c1 } = render(<FindingDetails finding={null} />);
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(<FindingDetails finding={undefined} />);
    expect(c2.firstChild).toBeNull();
  });

  it('renders explanation message and resource details for API finding', () => {
    render(<FindingDetails finding={mockApiFinding} />);

    expect(
      screen.getByText(/POST \/api\/users exists in source code/i)
    ).toBeInTheDocument();
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('/api/users')).toBeInTheDocument();
  });

  it('renders source code file and line number when present', () => {
    render(<FindingDetails finding={mockApiFinding} />);

    expect(screen.getByText('src/routes/users.js')).toBeInTheDocument();
    expect(screen.getByText('Line 25')).toBeInTheDocument();
    expect(screen.getByText(/prefix resolved/i)).toBeInTheDocument();
  });

  it('renders "No documentation evidence" message when doc evidence is null for UNDOCUMENTED finding', () => {
    render(<FindingDetails finding={mockApiFinding} />);

    expect(
      screen.getByText(/no documentation evidence — this item was not found in repository documentation/i)
    ).toBeInTheDocument();
  });

  it('renders resource name for environment variable finding', () => {
    render(<FindingDetails finding={mockEnvFinding} />);

    expect(screen.getByText('REDIS_PORT')).toBeInTheDocument();
  });

  it('renders documentation evidence file and line from source property', () => {
    render(<FindingDetails finding={mockEnvFinding} />);

    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.getByText('Line 88')).toBeInTheDocument();
    expect(screen.getByText(/extracted from markdown table/i)).toBeInTheDocument();
  });

  it('renders "No source code evidence" message when code evidence is null for OBSOLETE finding', () => {
    render(<FindingDetails finding={mockEnvFinding} />);

    expect(
      screen.getByText(/no source code evidence — this item was not found in the analyzed source code/i)
    ).toBeInTheDocument();
  });

  it('displays security notice that raw file excerpts are not stored', () => {
    render(<FindingDetails finding={mockApiFinding} />);

    expect(
      screen.getByText(/file content excerpts are not persisted to maintain repository privacy/i)
    ).toBeInTheDocument();
  });
});

