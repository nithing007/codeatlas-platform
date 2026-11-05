/**
 * FindingFilters — filter controls for Drift Findings Explorer.
 * Supports:
 *   - Severity pills (All, High, Medium, Low) with count badges.
 *   - Dynamic rule-type dropdown (built from actual findings present).
 *   - Search input for rule ID, title, description, and file paths.
 *   - Reset filters action.
 */

import styles from './FindingFilters.module.css';

const RULE_LABELS = {
  UNDOCUMENTED_API: 'Undocumented API',
  OBSOLETE_API_DOCUMENTATION: 'Obsolete API Documentation',
  UNDOCUMENTED_ENVIRONMENT_VARIABLE: 'Undocumented Env Var',
  OBSOLETE_ENVIRONMENT_VARIABLE: 'Obsolete Env Var',
};

function formatRuleLabel(type) {
  if (!type) return 'Unknown Rule';
  return RULE_LABELS[type] || type.replace(/_/g, ' ');
}

export function FindingFilters({
  selectedSeverity = 'ALL',
  onSelectSeverity,
  selectedRule = 'ALL',
  onSelectRule,
  searchQuery = '',
  onSearchChange,
  availableRules = [],
  severityCounts = { total: 0, high: 0, medium: 0, low: 0 },
  onResetFilters,
  hasActiveFilters = false,
}) {
  const severities = [
    { id: 'ALL', label: 'All', count: severityCounts.total },
    { id: 'HIGH', label: 'High', count: severityCounts.high },
    { id: 'MEDIUM', label: 'Medium', count: severityCounts.medium },
    { id: 'LOW', label: 'Low', count: severityCounts.low },
  ];

  return (
    <div className={styles.filterBar} data-testid="finding-filters">
      {/* Top row: Search input + Rule filter dropdown */}
      <div className={styles.topRow}>
        <div className={styles.searchWrapper}>
          <span className={styles.searchIcon} aria-hidden="true">🔍</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by rule, description, or file path…"
            className={styles.searchInput}
            aria-label="Search drift findings"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className={styles.clearSearchBtn}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Dynamic rule-type filter */}
        <div className={styles.ruleFilterWrapper}>
          <label htmlFor="rule-filter-select" className={styles.selectLabel}>
            Rule:
          </label>
          <select
            id="rule-filter-select"
            value={selectedRule}
            onChange={(e) => onSelectRule(e.target.value)}
            className={styles.ruleSelect}
            aria-label="Filter by rule type"
          >
            <option value="ALL">All Rules ({availableRules.length})</option>
            {availableRules.map((rule) => (
              <option key={rule} value={rule}>
                {formatRuleLabel(rule)}
              </option>
            ))}
          </select>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            className={styles.resetBtn}
            aria-label="Reset all filters"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Bottom row: Severity filter pills */}
      <div className={styles.severityRow} role="group" aria-label="Filter by severity">
        <span className={styles.severityRowLabel}>Severity:</span>
        <div className={styles.severityPills}>
          {severities.map((sev) => {
            const isSelected = selectedSeverity === sev.id;
            return (
              <button
                key={sev.id}
                type="button"
                onClick={() => onSelectSeverity(sev.id)}
                className={`${styles.severityPill} ${
                  isSelected ? styles.severityPillActive : ''
                } ${styles[`pill--${sev.id.toLowerCase()}`]}`}
                aria-pressed={isSelected}
              >
                <span>{sev.label}</span>
                <span className={styles.pillCount}>{sev.count}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

