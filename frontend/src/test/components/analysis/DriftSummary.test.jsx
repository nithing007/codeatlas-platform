/**
 * DriftSummary component tests.
 * Verifies severity count cards, zero-drift state, and missing data handling.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DriftSummary } from '../../../components/analysis/DriftSummary.jsx';

describe('DriftSummary', () => {
  it('renders total, high, medium, and low counts', () => {
    const drift = { summary: { total: 7, high: 3, medium: 3, low: 1 } };
    render(<DriftSummary drift={drift} />);

    const totalLabel = screen.getByText('Total');
    expect(totalLabel.parentElement).toHaveTextContent('7');

    const highLabel = screen.getByText('High');
    expect(highLabel.parentElement).toHaveTextContent('3');

    const mediumLabel = screen.getByText('Medium');
    expect(mediumLabel.parentElement).toHaveTextContent('3');

    const lowLabel = screen.getByText('Low');
    expect(lowLabel.parentElement).toHaveTextContent('1');
  });

  it('renders severity labels', () => {
    const drift = { summary: { total: 2, high: 1, medium: 1, low: 0 } };
    render(<DriftSummary drift={drift} />);

    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
  });

  it('shows no-drift message when total is zero', () => {
    const drift = { summary: { total: 0, high: 0, medium: 0, low: 0 } };
    render(<DriftSummary drift={drift} />);

    expect(
      screen.getByText(/no documentation drift detected/i)
    ).toBeInTheDocument();
  });

  it('shows drift count message when total > 0', () => {
    const drift = { summary: { total: 5, high: 2, medium: 2, low: 1 } };
    render(<DriftSummary drift={drift} />);

    const note = screen.getByText(/drift findings detected/i).closest('p');
    expect(note).toHaveTextContent('5 drift findings detected.');
  });

  it('renders with undefined drift gracefully', () => {
    render(<DriftSummary drift={undefined} />);
    expect(screen.getByText(/no documentation drift detected/i)).toBeInTheDocument();
    
    expect(screen.getByText('Total').parentElement).toHaveTextContent('0');
    expect(screen.getByText('High').parentElement).toHaveTextContent('0');
    expect(screen.getByText('Medium').parentElement).toHaveTextContent('0');
    expect(screen.getByText('Low').parentElement).toHaveTextContent('0');
  });

  it('renders "Documentation Drift" heading', () => {
    render(<DriftSummary drift={{ summary: { total: 0, high: 0, medium: 0, low: 0 } }} />);
    expect(screen.getByText('Documentation Drift')).toBeInTheDocument();
  });

  it('uses singular "drift finding" when total is 1', () => {
    const drift = { summary: { total: 1, high: 1, medium: 0, low: 0 } };
    render(<DriftSummary drift={drift} />);

    const note = screen.getByText(/drift finding detected/i).closest('p');
    expect(note).toHaveTextContent('1 drift finding detected.');
  });
});
