/**
 * LandingPage — Public product landing page for CodeAtlas.
 * Explains documentation drift, core capabilities, workflow, and technical architecture.
 */

import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Button } from '../components/ui/Button.jsx';
import styles from './LandingPage.module.css';

const CURRENT_YEAR = new Date().getFullYear();

export function LandingPage() {
  const { isAuthenticated } = useAuth();

  const handleScrollToFeatures = (e) => {
    e.preventDefault();
    const el = document.getElementById('capabilities');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className={styles.wrapper}>
      {/* ─── Hero Section ──────────────────────────────────────────────── */}
      <section className={styles.heroSection}>
        <div className={styles.heroContainer}>
          <div className={styles.badge}>
            <span className={styles.badgeDot} aria-hidden="true" />
            Repository Intelligence &amp; Documentation Drift Detection
          </div>

          <h1 className={styles.headline}>
            Bridge the gap between your <br />
            <span className={styles.gradientText}>source code</span> and{' '}
            <span className={styles.gradientText}>documentation</span>.
          </h1>

          <p className={styles.subheadline}>
            CodeAtlas performs deep AST static analysis on your repositories, automatically
            cross-referencing real implementation against Markdown docs and OpenAPI specs
            to uncover silent drift, missing endpoints, and uncatalogued environment variables.
          </p>

          <div className={styles.ctaGroup}>
            {isAuthenticated ? (
              <Link to="/dashboard">
                <Button variant="primary" size="lg">
                  Go to Dashboard &rarr;
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="primary" size="lg">
                    Get started free
                  </Button>
                </Link>
                <Link to="/login" className={styles.secondaryCta}>
                  Sign in
                </Link>
              </>
            )}
            <a
              href="#capabilities"
              onClick={handleScrollToFeatures}
              className={styles.scrollLink}
            >
              Explore Features &darr;
            </a>
          </div>

          {/* Interactive Code & Drift Preview Card */}
          <div className={styles.previewCard} aria-label="CodeAtlas Drift Detection Preview">
            <div className={styles.previewHeader}>
              <div className={styles.previewDots}>
                <span className={styles.dotRed} />
                <span className={styles.dotYellow} />
                <span className={styles.dotGreen} />
              </div>
              <span className={styles.previewPath}>analysis/drift-detection-engine</span>
              <span className={styles.previewStatus}>STATUS: 1 HIGH SEVERITY DRIFT</span>
            </div>

            <div className={styles.previewBody}>
              <div className={styles.previewCol}>
                <div className={styles.colHeader}>
                  <span className={styles.colTagCode}>CODE REALITY</span>
                  <span className={styles.colFile}>src/routes/authRoutes.js:28</span>
                </div>
                <pre className={styles.codeSnippet}>
                  <code>
                    <span className={styles.codeComment}>// Live Route Added in Production:</span>{'\n'}
                    <span className={styles.codeKeyword}>router</span>.
                    <span className={styles.codeMethod}>post</span>(
                    <span className={styles.codeString}>&apos;/verify-otp&apos;</span>, verifyOtp);
                  </code>
                </pre>
              </div>

              <div className={styles.previewDivider}>
                <span className={styles.dividerIcon}>⚡</span>
              </div>

              <div className={styles.previewCol}>
                <div className={styles.colHeader}>
                  <span className={styles.colTagDoc}>DOCUMENTATION SPEC</span>
                  <span className={styles.colFile}>README.md / openapi.yaml</span>
                </div>
                <div className={styles.driftBox}>
                  <div className={styles.driftWarning}>
                    <span className={styles.driftWarningIcon}>⚠️</span>
                    <strong>UNDOCUMENTED_ENDPOINT (High)</strong>
                  </div>
                  <p className={styles.driftMessage}>
                    Endpoint <code>POST /api/auth/verify-otp</code> is implemented in code but omitted from API documentation.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Problem & Solution Section ─────────────────────────────────── */}
      <section className={styles.section} id="problem-solution">
        <div className={styles.container}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionKicker}>THE CHALLENGE &amp; THE SOLUTION</span>
            <h2 className={styles.sectionTitle}>Why Documentation Drifts Out of Sync</h2>
            <p className={styles.sectionSubtitle}>
              Modern software teams ship features at high velocity. Manual documentation
              updates inevitably fail to keep pace with code changes.
            </p>
          </div>

          <div className={styles.problemSolutionGrid}>
            <div className={styles.cardProblem}>
              <div className={styles.cardBadgeProblem}>The Documentation Drift Problem</div>
              <ul className={styles.problemList}>
                <li>
                  <strong>Undocumented API Endpoints:</strong> New REST endpoints and routes are merged into source files without updating READMEs or OpenAPI specifications.
                </li>
                <li>
                  <strong>Uncatalogued Environment Variables:</strong> Config variables added to code without matching entries in <code>.env.example</code> lead to broken deployments.
                </li>
                <li>
                  <strong>Stale Route Contracts:</strong> Changed HTTP methods or renamed prefixes silently break frontend and third-party integrations.
                </li>
                <li>
                  <strong>Knowledge Silos:</strong> Onboarding new engineers becomes painful when written docs deviate from production realities.
                </li>
              </ul>
            </div>

            <div className={styles.cardSolution}>
              <div className={styles.cardBadgeSolution}>How CodeAtlas Solves It</div>
              <ul className={styles.solutionList}>
                <li>
                  <strong>AST Static Analysis:</strong> Uses Babel and deterministic parsers to inspect route registrations, Express app trees, and environment variables.
                </li>
                <li>
                  <strong>Documentation Fact Extraction:</strong> Reads README tables, Markdown code blocks, curl snippets, and OpenAPI definitions into structured claims.
                </li>
                <li>
                  <strong>Automated Drift Engine:</strong> Discovers missing endpoints, ghost documentation, and undeclared environment variables.
                </li>
                <li>
                  <strong>Persistent Worker Pipeline:</strong> Runs scans asynchronously in a dedicated worker with retry guarantees and lease recovery.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Core Capabilities Section ─────────────────────────────────── */}
      <section className={styles.sectionAlt} id="capabilities">
        <div className={styles.container}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionKicker}>CORE CAPABILITIES</span>
            <h2 className={styles.sectionTitle}>Engineered for Repository Intelligence</h2>
            <p className={styles.sectionSubtitle}>
              Built on a decoupled MERN architecture with an independent static analyzer engine and persistent background queue.
            </p>
          </div>

          <div className={styles.capabilitiesGrid}>
            {CAPABILITIES.map((cap) => (
              <div key={cap.title} className={styles.capabilityCard}>
                <div className={styles.capIconWrapper}>
                  <span className={styles.capIcon} aria-hidden="true">{cap.icon}</span>
                </div>
                <h3 className={styles.capTitle}>{cap.title}</h3>
                <p className={styles.capDesc}>{cap.desc}</p>
                <div className={styles.capTag}>{cap.tag}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How It Works Workflow ──────────────────────────────────────── */}
      <section className={styles.section} id="how-it-works">
        <div className={styles.container}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionKicker}>THE WORKFLOW</span>
            <h2 className={styles.sectionTitle}>From GitHub URL to Complete Drift Analysis</h2>
            <p className={styles.sectionSubtitle}>
              Five deterministic steps to illuminate the health and synchronization of your repository.
            </p>
          </div>

          <div className={styles.workflowSteps}>
            {STEPS.map((step, idx) => (
              <div key={step.number} className={styles.stepCard}>
                <div className={styles.stepNumberBadge}>{step.number}</div>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepDesc}>{step.desc}</p>
                {idx < STEPS.length - 1 && <div className={styles.stepConnector} aria-hidden="true" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Bottom CTA Banner ─────────────────────────────────────────── */}
      <section className={styles.ctaBannerSection}>
        <div className={styles.container}>
          <div className={styles.ctaBanner}>
            <h2 className={styles.ctaBannerTitle}>Ready to inspect your repository?</h2>
            <p className={styles.ctaBannerSubtitle}>
              Sign in with your email or Google account and start your first asynchronous scan in seconds.
            </p>
            <div className={styles.ctaBannerActions}>
              {isAuthenticated ? (
                <Link to="/dashboard">
                  <Button variant="primary" size="lg">
                    Open Dashboard
                  </Button>
                </Link>
              ) : (
                <Link to="/login">
                  <Button variant="primary" size="lg">
                    Get Started Free
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Footer ────────────────────────────────────────────────────── */}
      <footer className={styles.footer} role="contentinfo">
        <div className={styles.footerContainer}>
          <div className={styles.footerBrand}>
            <div className={styles.footerLogo}>
              <span className={styles.footerLogoIcon}>◈</span>
              <span className={styles.footerLogoText}>CodeAtlas</span>
            </div>
            <p className={styles.footerTagline}>
              Repository Intelligence &amp; Documentation Drift Detection Platform.
            </p>
            <span className={styles.footerStatus}>
              <span className={styles.statusIndicator} /> Persistent Queue &amp; Analyzer Operational
            </span>
          </div>

          <div className={styles.footerLinksGroup}>
            <div className={styles.footerCol}>
              <h4 className={styles.footerHeading}>Navigation</h4>
              <ul className={styles.footerList}>
                <li><Link to="/">Home</Link></li>
                <li><Link to="/dashboard">Dashboard</Link></li>
                <li><Link to="/repositories">Repositories</Link></li>
                {!isAuthenticated && <li><Link to="/login">Sign In</Link></li>}
              </ul>
            </div>

            <div className={styles.footerCol}>
              <h4 className={styles.footerHeading}>Platform</h4>
              <ul className={styles.footerList}>
                <li><a href="#capabilities">Core Capabilities</a></li>
                <li><a href="#how-it-works">How It Works</a></li>
                <li><a href="#problem-solution">Drift Detection</a></li>
              </ul>
            </div>

            <div className={styles.footerCol}>
              <h4 className={styles.footerHeading}>Architecture</h4>
              <ul className={styles.footerList}>
                <li><span>React 19 + Vite</span></li>
                <li><span>Node.js + Express</span></li>
                <li><span>MongoDB Queue Worker</span></li>
                <li><span>AST Static Analyzer</span></li>
              </ul>
            </div>
          </div>
        </div>

        <div className={styles.footerBottom}>
          <div className={styles.footerBottomContent}>
            <span>&copy; {CURRENT_YEAR} CodeAtlas Platform. All rights reserved.</span>
            <span>Deterministic Static Analysis &amp; Repository Intelligence</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

const CAPABILITIES = [
  {
    icon: '◈',
    title: 'Repository Intelligence',
    desc: 'Deep inventory of codebases, classification into source, config, and docs, secret filtering, and file tree taxonomy.',
    tag: 'Inventory & Classification',
  },
  {
    icon: '⬡',
    title: 'Static Code Analysis',
    desc: 'AST-powered inspection of Express route declarations, HTTP verbs, path parameter extraction, and prefix resolution.',
    tag: 'AST Inspection',
  },
  {
    icon: '⟳',
    title: 'Documentation Drift Detection',
    desc: 'Automated algorithms cross-check code endpoints against Markdown tables and OpenAPI definitions to spot discrepancies.',
    tag: 'Drift Engine',
  },
  {
    icon: '⚙',
    title: 'Environment Variable Analysis',
    desc: 'Extracts runtime env var references from source and cross-references them against .env.example templates.',
    tag: 'Configuration Sync',
  },
  {
    icon: '📄',
    title: 'API Documentation Analysis',
    desc: 'Identifies undocumented routes, ghost endpoints declared in docs but missing in code, and mismatched HTTP methods.',
    tag: 'API Contracts',
  },
  {
    icon: '⏱',
    title: 'Asynchronous Scanning',
    desc: 'Non-blocking scan triggers return immediately while background workers process deep analysis without request timeouts.',
    tag: 'Async Lifecycle',
  },
  {
    icon: '🛡',
    title: 'Persistent Scan Processing',
    desc: 'MongoDB queue with heartbeat leases, automatic stalled-job recovery, exponential backoff retries, and lock deduplication.',
    tag: 'Queue Reliability',
  },
  {
    icon: '🔍',
    title: 'Findings Exploration',
    desc: 'Comprehensive explorer with multi-dimensional filtering by severity (High, Medium, Low), category, and line-level evidence.',
    tag: 'Interactive Explorer',
  },
];

const STEPS = [
  {
    number: '01',
    title: 'Import Repository',
    desc: 'Provide any public GitHub repository URL. CodeAtlas verifies branch structure and metadata automatically.',
  },
  {
    number: '02',
    title: 'Queue Analysis',
    desc: 'A background scan is enqueued into our persistent MongoDB queue with concurrency protection and atomic claim locks.',
  },
  {
    number: '03',
    title: 'Extract Facts',
    desc: 'The dedicated analyzer resolves repository trees, extracts AST route facts, and reads documentation claims.',
  },
  {
    number: '04',
    title: 'Detect Drift',
    desc: 'The drift engine compares code facts with documentation facts, evaluating differences into graded severity findings.',
  },
  {
    number: '05',
    title: 'Review Findings',
    desc: 'Inspect interactive drift reports with exact source lines, documentation references, and remediation guidance.',
  },
];
