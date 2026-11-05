/**
 * FindingFilters component tests.
 * Verifies search input, dynamic rule dropdown, severity pills, and reset action.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FindingFilters } from '../../../components/analysis/FindingFilters.jsx';

describe('FindingFilters', () => {
  const defaultCounts = { total: 10, high: 4, medium: 4, low: 2 };
  const mockRules = ['UNDOCUMENTED_API', 'UNDOCUMENTED_ENVIRONMENT_VARIABLE'];

  it('renders search input with placeholder and accessible label', () => {
    render(<FindingFilters searchQuery="" onSearchChange={vi.fn()} />);

    const input = screen.getByRole('searchbox', { name: /search drift findings/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('placeholder', expect.stringContaining('Search by rule'));
  });

  it('calls onSearchChange when user types in search input', async () => {
    const handleSearch = vi.fn();
    render(<FindingFilters searchQuery="" onSearchChange={handleSearch} />);

    const input = screen.getByRole('searchbox', { name: /search drift findings/i });
    await userEvent.type(input, 'users');

    expect(handleSearch).toHaveBeenCalled();
  });

  it('renders clear button when searchQuery is present and clears search on click', async () => {
    const handleSearch = vi.fn();
    render(<FindingFilters searchQuery="health" onSearchChange={handleSearch} />);

    const clearBtn = screen.getByRole('button', { name: /clear search/i });
    expect(clearBtn).toBeInTheDocument();

    await userEvent.click(clearBtn);
    expect(handleSearch).toHaveBeenCalledWith('');
  });

  it('populates rule dropdown dynamically from availableRules', () => {
    render(
      <FindingFilters
        availableRules={mockRules}
        selectedRule="ALL"
        onSelectRule={vi.fn()}
      />
    );

    const select = screen.getByRole('combobox', { name: /filter by rule type/i });
    expect(select).toBeInTheDocument();

    expect(screen.getByRole('option', { name: /all rules/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /undocumented api/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /undocumented env var/i })).toBeInTheDocument();
  });

  it('calls onSelectRule when a rule is selected', async () => {
    const handleSelectRule = vi.fn();
    render(
      <FindingFilters
        availableRules={mockRules}
        selectedRule="ALL"
        onSelectRule={handleSelectRule}
      />
    );

    const select = screen.getByRole('combobox', { name: /filter by rule type/i });
    await userEvent.selectOptions(select, 'UNDOCUMENTED_API');

    expect(handleSelectRule).toHaveBeenCalledWith('UNDOCUMENTED_API');
  });

  it('renders severity pills with counts and indicates active selection', () => {
    render(
      <FindingFilters
        selectedSeverity="HIGH"
        onSelectSeverity={vi.fn()}
        severityCounts={defaultCounts}
      />
    );

    const allBtn = screen.getByRole('button', { name: /all 10/i });
    const highBtn = screen.getByRole('button', { name: /high 4/i });
    const medBtn = screen.getByRole('button', { name: /medium 4/i });
    const lowBtn = screen.getByRole('button', { name: /low 2/i });

    expect(allBtn).toBeInTheDocument();
    expect(highBtn).toBeInTheDocument();
    expect(medBtn).toBeInTheDocument();
    expect(lowBtn).toBeInTheDocument();

    expect(highBtn).toHaveAttribute('aria-pressed', 'true');
    expect(allBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onSelectSeverity when a severity pill is clicked', async () => {
    const handleSelectSev = vi.fn();
    render(
      <FindingFilters
        selectedSeverity="ALL"
        onSelectSeverity={handleSelectSev}
        severityCounts={defaultCounts}
      />
    );

    const medBtn = screen.getByRole('button', { name: /medium 4/i });
    await userEvent.click(medBtn);

    expect(handleSelectSev).toHaveBeenCalledWith('MEDIUM');
  });

  it('renders Reset Filters button when hasActiveFilters is true', async () => {
    const handleReset = vi.fn();
    render(
      <FindingFilters
        hasActiveFilters={true}
        onResetFilters={handleReset}
      />
    );

    const resetBtn = screen.getByRole('button', { name: /reset all filters/i });
    expect(resetBtn).toBeInTheDocument();

    await userEvent.click(resetBtn);
    expect(handleReset).toHaveBeenCalledTimes(1);
  });

  it('does not render Reset Filters button when hasActiveFilters is false', () => {
    render(<FindingFilters hasActiveFilters={false} />);
    expect(screen.queryByRole('button', { name: /reset all filters/i })).not.toBeInTheDocument();
  });
});

