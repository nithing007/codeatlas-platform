/**
 * FindingCard — displays a single drift finding summary card with expandable details.
 *
 * Props:
 *   finding          {object}    Finding object
 *   isExpanded       {boolean}   Whether details are shown
 *   onToggleExpand   {function}  Callback when toggle button is clicked
 */

import { FindingDetails } from './FindingDetails.jsx';
import styles from './FindingCard.module.css';

const SEVERITY_CONFIG = {
  HIGH: { label: 'High', className: 'severityHigh' },
  MEDIUM: { label: 'Medium', className: 'severityMedium' },
  LOW: { label: 'Low', className: 'severityLow' },
};

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

export function FindingCard({ finding, isExpanded = false, onToggleExpand }) {
  if (!finding) return null;

  const {
    type,
    severity = 'LOW',
    title,
    message,
    codeEvidence,
    documentationEvidence,
  } = finding;

  const severityCfg = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.LOW;
  const ruleLabel = formatRuleLabel(type);

  const codeFile = codeEvidence?.file || codeEvidence?.source || null;
  const codeLine = typeof codeEvidence?.line === 'number' ? codeEvidence.line : null;

  const docFile = documentationEvidence?.file || documentationEvidence?.source || null;
  const docLine = typeof documentationEvidence?.line === 'number' ? documentationEvidence.line : null;

  return (
    <article
      className={`${styles.card} ${isExpanded ? styles.cardExpanded : ''}`}
      data-testid="finding-card"
    >
      <div className={styles.cardHeader}>
        <div className={styles.badgeRow}>
          <span
            className={`${styles.severityBadge} ${styles[severityCfg.className]}`}
            role="status"
          >
            {severityCfg.label}
          </span>
          <span className={styles.ruleBadge}>{ruleLabel}</span>
        </div>

        <button
          type="button"
          onClick={onToggleExpand}
          className={styles.toggleBtn}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? `Hide details for ${title}` : `View details for ${title}`}
        >
          {isExpanded ? 'Hide Details' : 'View Details'}
          <span className={styles.toggleIcon} aria-hidden="true">
            {isExpanded ? '▲' : '▼'}
          </span>
        </button>
      </div>

      <h3 className={styles.title}>{title || ruleLabel}</h3>
      <p className={styles.message}>{message}</p>

      {/* File references preview */}
      <div className={styles.filesRow}>
        {codeFile && (
          <span className={styles.fileTag} title={`Source: ${codeFile}`}>
            <span className={styles.fileTagIcon} aria-hidden="true">⟨/⟩</span>
            <span className={styles.filePath}>
              {codeFile}{codeLine ? `:${codeLine}` : ''}
            </span>
          </span>
        )}

        {docFile && (
          <span className={styles.fileTag} title={`Documentation: ${docFile}`}>
            <span className={styles.fileTagIcon} aria-hidden="true">📄</span>
            <span className={styles.filePath}>
              {docFile}{docLine ? `:${docLine}` : ''}
            </span>
          </span>
        )}
      </div>

      {isExpanded && <FindingDetails finding={finding} />}
    </article>
  );
}

