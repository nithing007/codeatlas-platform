/**
 * DriftFindingsExplorer component tests.
 * Comprehensive tests covering:
 *   - Overview rendering & counts
 *   - Severity filtering (HIGH/MEDIUM/LOW/ALL)
 *   - Dynamic rule type filtering
 *   - Full-text search (rule, description, file path)
 *   - Combined filtering and search
 *   - Expand all & collapse all
 *   - Empty scan state & zero-matches state
 *   - Pagination
 *   - Malformed data resilience
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DriftFindingsExplorer } from '../../../components/analysis/DriftFindingsExplorer.jsx';

const mockFindings = [
  {
    type: 'UNDOCUMENTED_API',
    severity: 'HIGH',
    title: 'Undocumented API endpoint',
    message: 'POST /api/users exists in source code but was not found in documentation.',
    resource: { method: 'POST', path: '/api/users' },
    codeEvidence: { file: 'src/routes/users.js', line: 20 },
    documentationEvidence: null,
  },
  {
    type: 'OBSOLETE_API_DOCUMENTATION',
    severity: 'MEDIUM',
    title: 'Documented API endpoint not found in source code',
    message: 'GET /api/legacy is documented but was not found in analyzed code.',
    resource: { method: 'GET', path: '/api/legacy' },
    codeEvidence: null,
    documentationEvidence: { source: 'docs/api.md', line: 45 },
  },
  {
    type: 'UNDOCUMENTED_ENVIRONMENT_VARIABLE',
    severity: 'MEDIUM',
    title: 'Undocumented environment variable',
    message: 'Environment variable "DATABASE_URL" is referenced in code but not in docs.',
    resource: { name: 'DATABASE_URL' },
    codeEvidence: { file: 'src/config/db.js', line: 5 },
    documentationEvidence: null,
  },
  {
    type: 'OBSOLETE_ENVIRONMENT_VARIABLE',
    severity: 'LOW',
    title: 'Documented environment variable not found in source code',
    message: 'Environment variable "OLD_TOKEN" is documented in README but not found in code.',
    resource: { name: 'OLD_TOKEN' },
    codeEvidence: null,
    documentationEvidence: { file: 'README.md', line: 120 },
  },
];

const mockSummary = {
  total: 4,
  high: 1,
  medium: 2,
  low: 1,
};

describe('DriftFindingsExplorer', () => {
  it('renders explorer heading and description', () => {
    render(<DriftFindingsExplorer findings={mockFindings} summary={mockSummary} />);

    expect(screen.getByRole('heading', { name: /drift findings explorer/i })).toBeInTheDocument();
    expect(screen.getByText(/investigate detected inconsistencies/i)).toBeInTheDocument();
  });

  it('renders empty state when findings array is empty', () => {
    render(<DriftFindingsExplorer findings={[]} summary={{ total: 0, high: 0, medium: 0, low: 0 }} />);

    expect(screen.getByText(/no documentation drift detected/i)).toBeInTheDocument();
    expect(screen.getByText(/all api endpoints and environment variables found in source code match/i)).toBeInTheDocument();
    expect(screen.queryByTestId('finding-filters')).not.toBeInTheDocument();
  });

  it('renders all finding cards by default', () => {
    render(<DriftFindingsExplorer findings={mockFindings} summary={mockSummary} />);

    const cards = screen.getAllByTestId('finding-card');
    expect(cards).toHaveLength(4);

    const countStatus = screen.getByText(/showing/i).closest('span');
    expect(countStatus).toHaveTextContent('Showing 4 findings');
  });

  it('filters findings by HIGH severity', async () => {
    render(<DriftFindingsExplorer findings={mockFindings} summary={mockSummary} />);

    const highPill = screen.getByRole('button', { name: /^high 1$/i });
    await userEvent.click(highPill);

    const cards = screen.getAllByTestId('finding-card');
    expect(cards).toHaveLength(1);
    expect(screen.getByText(/POST \/api\/users/)).toBeInTheDocument();
    expect(screen.queryByText(/GET \/api\/legacy/)).not.toBeInTheDocument();
  });

  it('filters findings by MEDIUM severity', async () => {
    render(<DriftFindingsExplorer findings={mockFindings} summary={mockSummary} />);

    const medPill = screen.getByRole('button', { name: /^medium 2$/i });
    await userEvent.click(medPill);

    const cards = screen.getAllByTestId('finding-card');
    expect(cards).toHaveLength(2);
    expect(screen.getByText(/GET \/api\/legacy/)).toBeInTheDocument();
    expect(screen.getByText(/DATABASE_URL/)).toBeInTheDocument();
  });

  it('filters findings by dynamic rule type dropdown', async () => {
    render(<DriftFindingsExplorer findings={mockFindings} summary={mockSummary} />);

    const select = screen.getByRole('combobox', { name: /filter by rule type/i });
    await userEvent.selectOptions(select, 'UNDOCUMENTED_ENVIRONMENT_VARIABLE');

    const cards = screen.getAllByTestId('finding-card');
    expect(cards).toHaveLength(1);
    expect(screen.getByText(/DATABASE_URL/)).toBeInTheDocument();
  });

  it('searches findings by rule type or title keyword', async () => {
    render(<DriftFindingsExplorer findings={mockFindings} summary={mockSummary} />);

    const searchInput = screen.getByRole('searchbox', { name: /search drift findings/i });
    await userEvent.type(searchInput, 'endpoint');

    const cards = screen.getAllByTestId('finding-card');
    expect(cards).toHaveLength(2);
  });

  it('searches findings by description / resource keyword', async () => {
    render(<DriftFindingsExplorer findings={mockFindings} summary={mockSummary} />);

    const searchInput = screen.getByRole('searchbox', { name: /search drift findings/i });
    await userEvent.type(searchInput, 'DATABASE_URL');

    const cards = screen.getAllByTestId('finding-card');
    expect(cards).toHaveLength(1);
    expect(screen.getByText(/DATABASE_URL/)).toBeInTheDocument();
  });

  it('searches findings by source code file path', async () => {
    render(<DriftFindingsExplorer findings={mockFindings} summary={mockSummary} />);

    const searchInput = screen.getByRole('searchbox', { name: /search drift findings/i });
    await userEvent.type(searchInput, 'users.js');

    const cards = screen.getAllByTestId('finding-card');
    expect(cards).toHaveLength(1);
    expect(screen.getByText(/src\/routes\/users\.js/)).toBeInTheDocument();
  });

  it('searches findings by documentation file path', async () => {
    render(<DriftFindingsExplorer findings={mockFindings} summary={mockSummary} />);

    const searchInput = screen.getByRole('searchbox', { name: /search drift findings/i });
    await userEvent.type(searchInput, 'README.md');

    const cards = screen.getAllByTestId('finding-card');
    expect(cards).toHaveLength(1);
    expect(screen.getByText(/README\.md/)).toBeInTheDocument();
  });

  it('combines severity filter and search query correctly', async () => {
    render(<DriftFindingsExplorer findings={mockFindings} summary={mockSummary} />);

    // Select Medium (matches GET /api/legacy and DATABASE_URL)
    const medPill = screen.getByRole('button', { name: /^medium 2$/i });
    await userEvent.click(medPill);

    // Search "legacy" -> should leave only GET /api/legacy
    const searchInput = screen.getByRole('searchbox', { name: /search drift findings/i });
    await userEvent.type(searchInput, 'legacy');

    const cards = screen.getAllByTestId('finding-card');
    expect(cards).toHaveLength(1);
    expect(screen.getByText(/GET \/api\/legacy/)).toBeInTheDocument();
  });

  it('shows zero matches state when no findings match search and clears on Reset', async () => {
    render(<DriftFindingsExplorer findings={mockFindings} summary={mockSummary} />);

    const searchInput = screen.getByRole('searchbox', { name: /search drift findings/i });
    await userEvent.type(searchInput, 'nonexistent_query_xyz');

    expect(screen.getByText(/no findings match the current filter criteria/i)).toBeInTheDocument();
    expect(screen.queryAllByTestId('finding-card')).toHaveLength(0);

    const clearBtn = screen.getByRole('button', { name: /clear filters/i });
    await userEvent.click(clearBtn);

    expect(screen.getAllByTestId('finding-card')).toHaveLength(4);
  });

  it('supports Expand All and Collapse All', async () => {
    render(<DriftFindingsExplorer findings={mockFindings} summary={mockSummary} />);

    const expandAllBtn = screen.getByRole('button', { name: /expand all/i });
    await userEvent.click(expandAllBtn);

    expect(screen.getAllByTestId('finding-details')).toHaveLength(4);

    const collapseAllBtn = screen.getByRole('button', { name: /collapse all/i });
    await userEvent.click(collapseAllBtn);

    expect(screen.queryByTestId('finding-details')).not.toBeInTheDocument();
  });

  it('handles pagination when findings exceed PAGE_SIZE', async () => {
    // Generate 12 findings
    const manyFindings = Array.from({ length: 12 }, (_, i) => ({
      type: 'UNDOCUMENTED_API',
      severity: 'HIGH',
      title: `Endpoint ${i + 1}`,
      message: `Message for endpoint ${i + 1}`,
      resource: { method: 'GET', path: `/api/test-${i + 1}` },
      codeEvidence: { file: `test-${i + 1}.js`, line: i + 1 },
      documentationEvidence: null,
    }));

    render(<DriftFindingsExplorer findings={manyFindings} />);

    // Page 1: 10 items
    expect(screen.getAllByTestId('finding-card')).toHaveLength(10);
    expect(screen.getByText(/page 1 of 2/i)).toBeInTheDocument();

    const nextBtn = screen.getByRole('button', { name: /next page/i });
    expect(nextBtn).toBeEnabled();

    await userEvent.click(nextBtn);

    // Page 2: remaining 2 items
    expect(screen.getAllByTestId('finding-card')).toHaveLength(2);
    expect(screen.getByText(/page 2 of 2/i)).toBeInTheDocument();
  });

  it('handles undefined or malformed findings gracefully without crashing', () => {
    render(<DriftFindingsExplorer findings={undefined} summary={undefined} />);
    expect(screen.getByText(/no documentation drift detected/i)).toBeInTheDocument();
  });
});
