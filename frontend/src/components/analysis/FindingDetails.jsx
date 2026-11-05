/**
 * FindingDetails — displays detailed evidence and explanation for a single drift finding.
 *
 * Props:
 *   finding  {object}  Finding object from result.drift.findings
 *                      { type, severity, title, message, resource, codeEvidence, documentationEvidence }
 */

import styles from './FindingDetails.module.css';

export function FindingDetails({ finding }) {
  if (!finding) return null;

  const {
    type,
    message,
    resource,
    codeEvidence,
    documentationEvidence,
  } = finding;

  const codeFile = codeEvidence?.file || codeEvidence?.source || null;
  const codeLine = typeof codeEvidence?.line === 'number' ? codeEvidence.line : null;

  const docFile = documentationEvidence?.file || documentationEvidence?.source || null;
  const docLine = typeof documentationEvidence?.line === 'number' ? documentationEvidence.line : null;

  return (
    <div className={styles.details} data-testid="finding-details">
      {/* Inconsistency Explanation */}
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>Explanation</h4>
        <p className={styles.messageText}>{message || 'No description provided.'}</p>
      </div>

      {/* Target Resource */}
      {resource && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Resource Target</h4>
          <div className={styles.resourceBox}>
            {resource.method && (
              <span className={styles.httpMethod}>{resource.method}</span>
            )}
            {resource.path && (
              <span className={styles.resourcePath}>{resource.path}</span>
            )}
            {resource.name && (
              <span className={styles.resourceName}>{resource.name}</span>
            )}
          </div>
        </div>
      )}

      {/* Two-column Evidence Grid */}
      <div className={styles.evidenceGrid}>
        {/* Source Code Evidence */}
        <div className={styles.evidenceColumn}>
          <div className={styles.evidenceHeader}>
            <span className={styles.evidenceIcon} aria-hidden="true">⟨/⟩</span>
            <h5 className={styles.evidenceTitle}>Source Code Evidence</h5>
          </div>

          {codeEvidence ? (
            <div className={styles.evidenceCard}>
              <div className={styles.evidenceRow}>
                <span className={styles.evidenceLabel}>File:</span>
                <span className={styles.evidenceValue} title={codeFile || undefined}>
                  {codeFile || 'File path unavailable'}
                </span>
              </div>

              {codeLine !== null && (
                <div className={styles.evidenceRow}>
                  <span className={styles.evidenceLabel}>Line:</span>
                  <span className={styles.evidenceValueMono}>Line {codeLine}</span>
                </div>
              )}

              {codeEvidence.prefixResolved && (
                <div className={styles.evidenceBadgeRow}>
                  <span className={styles.contextBadge}>Prefix Resolved</span>
                </div>
              )}

              {codeEvidence.fromTemplate && (
                <div className={styles.evidenceBadgeRow}>
                  <span className={styles.contextBadge}>.env.example template</span>
                </div>
              )}

              {codeEvidence.fromOpenApi && (
                <div className={styles.evidenceBadgeRow}>
                  <span className={styles.contextBadge}>OpenAPI spec</span>
                </div>
              )}
            </div>
          ) : (
            <div className={styles.noEvidenceBox}>
              <p className={styles.noEvidenceText}>
                {type?.startsWith('OBSOLETE')
                  ? 'No source code evidence — this item was not found in the analyzed source code.'
                  : 'Source code evidence is unavailable for this finding.'}
              </p>
            </div>
          )}
        </div>

        {/* Documentation Evidence */}
        <div className={styles.evidenceColumn}>
          <div className={styles.evidenceHeader}>
            <span className={styles.evidenceIcon} aria-hidden="true">📄</span>
            <h5 className={styles.evidenceTitle}>Documentation Evidence</h5>
          </div>

          {documentationEvidence ? (
            <div className={styles.evidenceCard}>
              <div className={styles.evidenceRow}>
                <span className={styles.evidenceLabel}>File:</span>
                <span className={styles.evidenceValue} title={docFile || undefined}>
                  {docFile || 'File path unavailable'}
                </span>
              </div>

              {docLine !== null && (
                <div className={styles.evidenceRow}>
                  <span className={styles.evidenceLabel}>Line:</span>
                  <span className={styles.evidenceValueMono}>Line {docLine}</span>
                </div>
              )}

              {documentationEvidence.fromCurl && (
                <div className={styles.evidenceBadgeRow}>
                  <span className={styles.contextBadge}>Extracted from curl command</span>
                </div>
              )}

              {documentationEvidence.fromTable && (
                <div className={styles.evidenceBadgeRow}>
                  <span className={styles.contextBadge}>Extracted from markdown table</span>
                </div>
              )}

              {documentationEvidence.fromOpenApi && (
                <div className={styles.evidenceBadgeRow}>
                  <span className={styles.contextBadge}>OpenAPI documentation</span>
                </div>
              )}
            </div>
          ) : (
            <div className={styles.noEvidenceBox}>
              <p className={styles.noEvidenceText}>
                {type?.startsWith('UNDOCUMENTED')
                  ? 'No documentation evidence — this item was not found in repository documentation.'
                  : 'Documentation evidence is unavailable for this finding.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Security notice regarding source/doc excerpts */}
      <p className={styles.securityNote}>
        File content excerpts are not persisted to maintain repository privacy and security. Refer to the indicated file and line numbers in your codebase.
      </p>
    </div>
  );
}

