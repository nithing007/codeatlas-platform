/**
 * FindingCard component tests.
 * Verifies card summary, badges, file tags, expand/collapse toggle, and accessibility.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FindingCard } from '../../../components/analysis/FindingCard.jsx';

const mockFinding = {
  type: 'UNDOCUMENTED_API',
  severity: 'HIGH',
  title: 'Undocumented API endpoint',
  message: 'GET /api/health exists in source code but was not found in documentation.',
  resource: { method: 'GET', path: '/api/health' },
  codeEvidence: { file: 'src/routes/health.js', line: 10 },
  documentationEvidence: null,
};

describe('FindingCard', () => {
  it('returns null if finding is null', () => {
    const { container } = render(<FindingCard finding={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders severity badge with correct label and status role', () => {
    render(<FindingCard finding={mockFinding} />);

    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('High');
  });

  it('renders rule label and finding title', () => {
    render(<FindingCard finding={mockFinding} />);

    expect(screen.getByText('Undocumented API')).toBeInTheDocument();
    expect(screen.getByText('Undocumented API endpoint')).toBeInTheDocument();
    expect(screen.getByText(/GET \/api\/health exists in source code/i)).toBeInTheDocument();
  });

  it('renders source code file path and line number tag', () => {
    render(<FindingCard finding={mockFinding} />);

    expect(screen.getByText('src/routes/health.js:10')).toBeInTheDocument();
  });

  it('renders "View Details" button with aria-expanded="false" when collapsed', () => {
    render(<FindingCard finding={mockFinding} isExpanded={false} />);

    const btn = screen.getByRole('button', { name: /view details/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('finding-details')).not.toBeInTheDocument();
  });

  it('calls onToggleExpand when toggle button is clicked', async () => {
    const onToggle = vi.fn();
    render(<FindingCard finding={mockFinding} onToggleExpand={onToggle} isExpanded={false} />);

    const btn = screen.getByRole('button', { name: /view details/i });
    await userEvent.click(btn);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders FindingDetails and "Hide Details" button with aria-expanded="true" when expanded', () => {
    render(<FindingCard finding={mockFinding} isExpanded={true} />);

    const btn = screen.getByRole('button', { name: /hide details/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('finding-details')).toBeInTheDocument();
  });

  it('renders Medium and Low severities correctly', () => {
    const medFinding = { ...mockFinding, severity: 'MEDIUM' };
    const { rerender } = render(<FindingCard finding={medFinding} />);
    expect(screen.getByText('Medium')).toBeInTheDocument();

    const lowFinding = { ...mockFinding, severity: 'LOW' };
    rerender(<FindingCard finding={lowFinding} />);
    expect(screen.getByText('Low')).toBeInTheDocument();
  });
});

