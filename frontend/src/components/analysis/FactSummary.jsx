/**
 * FactSummary — displays extracted code and documentation facts.
 *
 * Props:
 *   facts  {object}  result.facts — { code: { apiEndpoints, envVars, dependencies, scripts },
 *                                     documentation: { apiEndpoints, envVars } }
 */

import styles from './FactSummary.module.css';

function FactGroup({ title, items, renderItem, emptyLabel }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <div className={styles.factGroup}>
      <div className={styles.factGroupHeader}>
        <span className={styles.factGroupTitle}>{title}</span>
        <span className={styles.factGroupCount}>{list.length}</span>
      </div>
      {list.length === 0 ? (
        <p className={styles.emptyNote}>{emptyLabel || 'None detected.'}</p>
      ) : (
        <ul className={styles.factList} role="list">
          {list.map((item, idx) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={idx} className={styles.factItem}>
              {renderItem(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ApiEndpointItem({ item }) {
  return (
    <span className={styles.endpointItem}>
      <span className={styles.httpMethod}>{item.method}</span>
      <span className={styles.endpointPath}>{item.path}</span>
      {item.file && (
        <span className={styles.fileRef}>{item.file}{item.line ? `:${item.line}` : ''}</span>
      )}
    </span>
  );
}

function EnvVarItem({ item }) {
  return (
    <span className={styles.envVarItem}>
      <span className={styles.envVarName}>{item.name}</span>
      {item.file && (
        <span className={styles.fileRef}>{item.file}{item.line ? `:${item.line}` : ''}</span>
      )}
    </span>
  );
}

function DependencyItem({ item }) {
  return (
    <span className={styles.dependencyItem}>
      <span className={styles.depName}>{item.name}</span>
      {item.version && <span className={styles.depVersion}>{item.version}</span>}
      {item.type && item.type !== 'unknown' && (
        <span className={styles.depType}>{item.type}</span>
      )}
    </span>
  );
}

function ScriptItem({ item }) {
  return (
    <span className={styles.scriptItem}>
      <span className={styles.scriptName}>{item.name}</span>
      {item.command && <span className={styles.scriptCommand}>{item.command}</span>}
    </span>
  );
}

export function FactSummary({ facts }) {
  const code = facts?.code || {};
  const documentation = facts?.documentation || {};

  return (
    <section className={styles.factSummary} aria-label="Fact summary">
      <div className={styles.column}>
        <h2 className={styles.columnTitle}>Code Facts</h2>

        <FactGroup
          title="API Endpoints"
          items={code.apiEndpoints}
          renderItem={(item) => <ApiEndpointItem item={item} />}
          emptyLabel="No API endpoints detected in source code."
        />

        <FactGroup
          title="Environment Variables"
          items={code.envVars}
          renderItem={(item) => <EnvVarItem item={item} />}
          emptyLabel="No environment variables detected in source code."
        />

        <FactGroup
          title="Dependencies"
          items={code.dependencies}
          renderItem={(item) => <DependencyItem item={item} />}
          emptyLabel="No dependencies detected."
        />

        <FactGroup
          title="Scripts"
          items={code.scripts}
          renderItem={(item) => <ScriptItem item={item} />}
          emptyLabel="No scripts detected."
        />
      </div>

      <div className={styles.column}>
        <h2 className={styles.columnTitle}>Documentation Facts</h2>

        <FactGroup
          title="API Endpoints"
          items={documentation.apiEndpoints}
          renderItem={(item) => <ApiEndpointItem item={item} />}
          emptyLabel="No API endpoints detected in documentation."
        />

        <FactGroup
          title="Environment Variables"
          items={documentation.envVars}
          renderItem={(item) => <EnvVarItem item={item} />}
          emptyLabel="No environment variables detected in documentation."
        />
      </div>
    </section>
  );
}

