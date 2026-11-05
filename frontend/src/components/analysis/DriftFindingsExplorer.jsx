/**
 * DriftFindingsExplorer — explorer for investigating individual documentation drift findings.
 *
 * Provides:
 *   - Overview count metrics (Total, High, Medium, Low).
 *   - Filtering by Severity (All, High, Medium, Low).
 *   - Filtering by dynamic Rule types (built from actual findings present).
 *   - Full-text search across rule, title, description, and file paths.
 *   - Expandable finding cards with source code and documentation evidence.
 *   - Pagination when findings count exceeds PAGE_SIZE.
 *   - Empty and zero-match states.
 *
 * Props:
 *   findings  {Array}   result.drift.findings
 *   summary   {object}  result.drift.summary
 */

import { useState, useMemo, useCallback } from 'react';
import { FindingCard } from './FindingCard.jsx';
import { FindingFilters } from './FindingFilters.jsx';
import styles from './DriftFindingsExplorer.module.css';

const PAGE_SIZE = 10;

function generateFindingId(finding, index) {
  const type = finding?.type || 'FINDING';
  const resourceKey = finding?.resource?.method
    ? `${finding.resource.method}-${finding.resource.path}`
    : finding?.resource?.name || 'res';
  return `${type}-${resourceKey}-${index}`;
}

export function DriftFindingsExplorer({ findings, summary }) {
  const rawFindings = useMemo(() => {
    return Array.isArray(findings) ? findings : [];
  }, [findings]);

  // Compute available rule types dynamically from actual findings
  const availableRules = useMemo(() => {
    const rules = new Set();
    for (const f of rawFindings) {
      if (f && f.type) {
        rules.add(f.type);
      }
    }
    return Array.from(rules).sort();
  }, [rawFindings]);

  // Compute severity counts
  const severityCounts = useMemo(() => {
    const counts = {
      total: typeof summary?.total === 'number' ? summary.total : 0,
      high: typeof summary?.high === 'number' ? summary.high : 0,
      medium: typeof summary?.medium === 'number' ? summary.medium : 0,
      low: typeof summary?.low === 'number' ? summary.low : 0,
    };

    // If summary is absent or 0 but rawFindings has items, derive from rawFindings
    if (counts.total === 0 && rawFindings.length > 0) {
      counts.total = rawFindings.length;
      for (const f of rawFindings) {
        if (f.severity === 'HIGH') counts.high++;
        else if (f.severity === 'MEDIUM') counts.medium++;
        else if (f.severity === 'LOW') counts.low++;
      }
    }

    return counts;
  }, [summary, rawFindings]);

  // Filter & Search states
  const [selectedSeverity, setSelectedSeverity] = useState('ALL');
  const [selectedRule, setSelectedRule] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [page, setPage] = useState(1);

  const hasActiveFilters =
    selectedSeverity !== 'ALL' || selectedRule !== 'ALL' || searchQuery.trim().length > 0;

  const handleResetFilters = useCallback(() => {
    setSelectedSeverity('ALL');
    setSelectedRule('ALL');
    setSearchQuery('');
    setPage(1);
  }, []);

  const handleToggleExpand = useCallback((id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleExpandAll = useCallback((ids) => {
    setExpandedIds(new Set(ids));
  }, []);

  const handleCollapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  // Filtered findings list
  const filteredFindings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return rawFindings.filter((f) => {
      if (!f) return false;

      // Severity filter
      if (selectedSeverity !== 'ALL' && f.severity !== selectedSeverity) {
        return false;
      }

      // Rule filter
      if (selectedRule !== 'ALL' && f.type !== selectedRule) {
        return false;
      }

      // Search query
      if (q.length > 0) {
        const typeMatch = f.type && f.type.toLowerCase().includes(q);
        const titleMatch = f.title && f.title.toLowerCase().includes(q);
        const messageMatch = f.message && f.message.toLowerCase().includes(q);

        const methodMatch =
          f.resource?.method && f.resource.method.toLowerCase().includes(q);
        const pathMatch =
          f.resource?.path && f.resource.path.toLowerCase().includes(q);
        const nameMatch =
          f.resource?.name && f.resource.name.toLowerCase().includes(q);

        const codeFile = f.codeEvidence?.file || f.codeEvidence?.source || '';
        const codeFileMatch = codeFile.toLowerCase().includes(q);

        const docFile =
          f.documentationEvidence?.file || f.documentationEvidence?.source || '';
        const docFileMatch = docFile.toLowerCase().includes(q);

        if (
          !typeMatch &&
          !titleMatch &&
          !messageMatch &&
          !methodMatch &&
          !pathMatch &&
          !nameMatch &&
          !codeFileMatch &&
          !docFileMatch
        ) {
          return false;
        }
      }

      return true;
    });
  }, [rawFindings, selectedSeverity, selectedRule, searchQuery]);

  // Pagination
  const totalPages = Math.ceil(filteredFindings.length / PAGE_SIZE) || 1;
  const currentPage = Math.min(page, totalPages);
  const pagedFindings = useMemo(() => {
    if (filteredFindings.length <= PAGE_SIZE) return filteredFindings;
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredFindings.slice(start, start + PAGE_SIZE);
  }, [filteredFindings, currentPage]);

  const pagedIds = useMemo(() => {
    return pagedFindings.map((f, i) => generateFindingId(f, (currentPage - 1) * PAGE_SIZE + i));
  }, [pagedFindings, currentPage]);

  // Handlers for filter updates that reset page
  const handleSelectSeverity = useCallback((sev) => {
    setSelectedSeverity(sev);
    setPage(1);
  }, []);

  const handleSelectRule = useCallback((rule) => {
    setSelectedRule(rule);
    setPage(1);
  }, []);

  const handleSearchChange = useCallback((query) => {
    setSearchQuery(query);
    setPage(1);
  }, []);

  return (
    <section
      className={styles.explorer}
      aria-label="Drift Findings Explorer"
      data-testid="drift-findings-explorer"
    >
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h2 className={styles.title}>Drift Findings Explorer</h2>
          <p className={styles.subtitle}>
            Investigate detected inconsistencies between source code implementation and repository documentation.
          </p>
        </div>
      </div>

      {/* Zero findings in scan */}
      {rawFindings.length === 0 ? (
        <div className={styles.emptyScanBox}>
          <div className={styles.emptyIcon} aria-hidden="true">✓</div>
          <h3 className={styles.emptyTitle}>No Documentation Drift Detected</h3>
          <p className={styles.emptyDesc}>
            All API endpoints and environment variables found in source code match the repository documentation.
          </p>
        </div>
      ) : (
        <>
          {/* Filters & Search */}
          <FindingFilters
            selectedSeverity={selectedSeverity}
            onSelectSeverity={handleSelectSeverity}
            selectedRule={selectedRule}
            onSelectRule={handleSelectRule}
            searchQuery={searchQuery}
            onSearchChange={handleSearchChange}
            availableRules={availableRules}
            severityCounts={severityCounts}
            onResetFilters={handleResetFilters}
            hasActiveFilters={hasActiveFilters}
          />

          {/* Results Bar: count & expand/collapse all */}
          <div className={styles.resultsBar}>
            <span className={styles.resultsCount} role="status">
              Showing{' '}
              <strong>
                {filteredFindings.length}{' '}
                {filteredFindings.length === 1 ? 'finding' : 'findings'}
              </strong>
              {hasActiveFilters && ` (filtered from ${rawFindings.length})`}
            </span>

            {pagedFindings.length > 0 && (
              <div className={styles.expandActions}>
                <button
                  type="button"
                  onClick={() => handleExpandAll(pagedIds)}
                  className={styles.actionBtn}
                >
                  Expand All
                </button>
                <span className={styles.actionSep} aria-hidden="true">|</span>
                <button
                  type="button"
                  onClick={handleCollapseAll}
                  className={styles.actionBtn}
                >
                  Collapse All
                </button>
              </div>
            )}
          </div>

          {/* Filtered empty state (zero matches) */}
          {filteredFindings.length === 0 ? (
            <div className={styles.zeroMatchesBox}>
              <p className={styles.zeroMatchesText}>
                No findings match the current filter criteria.
              </p>
              <button
                type="button"
                onClick={handleResetFilters}
                className={styles.clearFiltersBtn}
              >
                Clear Filters
              </button>
            </div>
          ) : (
            <div className={styles.findingsList} role="list" aria-label="Findings list">
              {pagedFindings.map((finding, idx) => {
                const globalIndex = (currentPage - 1) * PAGE_SIZE + idx;
                const id = generateFindingId(finding, globalIndex);
                const isExpanded = expandedIds.has(id);

                return (
                  <FindingCard
                    key={id}
                    finding={finding}
                    isExpanded={isExpanded}
                    onToggleExpand={() => handleToggleExpand(id)}
                  />
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <nav className={styles.pagination} aria-label="Findings pagination">
              <span className={styles.pageInfo}>
                Page {currentPage} of {totalPages}
              </span>
              <div className={styles.paginationButtons}>
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className={styles.pageBtn}
                  aria-label="Previous page"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className={styles.pageBtn}
                  aria-label="Next page"
                >
                  Next
                </button>
              </div>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

