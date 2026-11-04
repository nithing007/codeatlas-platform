/**
 * AnalysisOverview component tests.
 * Verifies scan metadata, file count display, and graceful handling of missing fields.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalysisOverview } from '../../../components/analysis/AnalysisOverview.jsx';

const mockResult = {
  analyzerVersion: '1.2.3',
  commitSha: 'abcdef1234567890',
  branch: 'main',
  createdAt: '2026-11-04T10:00:00.000Z',
  fileCounts: {
    total: 42,
    source: 30,
    documentation: 5,
    configuration: 7,
    infrastructure: 0,
    other: 0,
  },
};

describe('AnalysisOverview', () => {
  it('renders scan metadata from result', () => {
    render(<AnalysisOverview scan={null} result={mockResult} />);

    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('abcdef1')).toBeInTheDocument(); // short SHA
    expect(screen.getByText('v1.2.3')).toBeInTheDocument();
  });

  it('renders file count cards', () => {
    render(<AnalysisOverview scan={null} result={mockResult} />);

    expect(screen.getByText('42')).toBeInTheDocument(); // total
    expect(screen.getByText('30')).toBeInTheDocument(); // source
    expect(screen.getByText('5')).toBeInTheDocument();  // docs
    expect(screen.getByText('7')).toBeInTheDocument();  // config
  });

  it('renders "Files Analyzed" section heading', () => {
    render(<AnalysisOverview scan={null} result={mockResult} />);
    expect(screen.getByText('Files Analyzed')).toBeInTheDocument();
  });

  it('renders "Scan Details" section heading', () => {
    render(<AnalysisOverview scan={null} result={mockResult} />);
    expect(screen.getByText('Scan Details')).toBeInTheDocument();
  });

  it('does not render file section when fileCounts.total is absent', () => {
    render(<AnalysisOverview scan={null} result={{ analyzerVersion: '1.0.0', fileCounts: {} }} />);
    expect(screen.queryByText('Files Analyzed')).not.toBeInTheDocument();
  });

  it('renders gracefully with minimal result data', () => {
    render(<AnalysisOverview scan={null} result={{ analyzerVersion: '0.9.0' }} />);
    expect(screen.getByText('Scan Details')).toBeInTheDocument();
    expect(screen.getByText('v0.9.0')).toBeInTheDocument();
  });

  it('uses scan prop data for branch and commitSha when present', () => {
    const scan = { branch: 'feature-x', commitSha: 'fffaaa1234567890' };
    render(<AnalysisOverview scan={scan} result={{ analyzerVersion: '1.0.0' }} />);
    expect(screen.getByText('feature-x')).toBeInTheDocument();
    expect(screen.getByText('fffaaa1')).toBeInTheDocument();
  });
});

