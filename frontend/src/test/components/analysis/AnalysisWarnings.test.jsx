/**
 * AnalysisWarnings component tests.
 * Verifies warning display, empty state, and no raw stack trace exposure.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalysisWarnings } from '../../../components/analysis/AnalysisWarnings.jsx';

describe('AnalysisWarnings', () => {
  it('renders each warning message', () => {
    const warnings = [
      'Failed to fetch README from GitHub.',
      'package.json parse error in /frontend/package.json.',
    ];
    render(<AnalysisWarnings warnings={warnings} />);

    expect(screen.getByText('Failed to fetch README from GitHub.')).toBeInTheDocument();
    expect(screen.getByText('package.json parse error in /frontend/package.json.')).toBeInTheDocument();
  });

  it('shows the correct warning count in the badge', () => {
    render(<AnalysisWarnings warnings={['Warning one', 'Warning two', 'Warning three']} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders empty state when warnings array is empty', () => {
    render(<AnalysisWarnings warnings={[]} />);
    expect(screen.getByText('No warnings were produced during analysis.')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders empty state when warnings is undefined', () => {
    render(<AnalysisWarnings warnings={undefined} />);
    expect(screen.getByText('No warnings were produced during analysis.')).toBeInTheDocument();
  });

  it('does not expose raw stack traces — renders safe string message only', () => {
    const warnings = ['TypeError: Cannot read properties of null'];
    render(<AnalysisWarnings warnings={warnings} />);
    expect(screen.getByText('TypeError: Cannot read properties of null')).toBeInTheDocument();
    // Should not render anything that looks like a stack frame
    expect(screen.queryByText(/at Object\./)).not.toBeInTheDocument();
  });

  it('renders "Warnings" section heading', () => {
    render(<AnalysisWarnings warnings={['A warning']} />);
    expect(screen.getByRole('region', { name: /analysis warnings/i })).toBeInTheDocument();
  });

  it('replaces non-string warnings with a safe fallback', () => {
    // Backend always sends strings, but guard against unexpected data
    render(<AnalysisWarnings warnings={[null]} />);
    expect(screen.getByText('An unexpected warning occurred.')).toBeInTheDocument();
  });
});

