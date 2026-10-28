#!/usr/bin/env node
/**
 * CodeAtlas Analyzer — Real Repository Validation Script
 *
 * Usage:
 *   node scripts/validateRepository.js https://github.com/OWNER/REPO
 *   node scripts/validateRepository.js https://github.com/OWNER/REPO BRANCH
 *
 * Runs the full production pipeline:
 *   GitHub URL → repositoryScanner → fact extraction → drift detection → human-readable report
 *
 * Read-only: never clones, never executes, never modifies the target repository.
 * No new dependencies beyond what the analyzer already uses.
 */

'use strict';

const { RepositoryScanner, GitHubRepositoryProvider } = require('../src/index');

// ─────────────────────────────────────────────
// 1. Parse and validate GitHub URL argument
// ─────────────────────────────────────────────

const GITHUB_REPO_URL_RE = /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(\.git)?\/?$/;

function parseGitHubUrl(raw) {
  if (!raw) {
    console.error('\nUsage: node scripts/validateRepository.js https://github.com/OWNER/REPO [BRANCH]\n');
    process.exit(1);
  }
  const m = GITHUB_REPO_URL_RE.exec(raw.trim());
  if (!m) {
    console.error(`\n❌ Invalid GitHub repository URL: "${raw}"`);
    console.error('   Expected format: https://github.com/owner/repository\n');
    process.exit(1);
  }
  return { owner: m[1], repo: m[2] };
}

// ─────────────────────────────────────────────
// 2. Human-readable report printer
// ─────────────────────────────────────────────

const HR  = '═'.repeat(70);
const HR2 = '─'.repeat(70);
const HR3 = '·'.repeat(70);

function pad(label, width = 40) {
  return label.padEnd(width, ' ');
}

function printReport(result, owner, repo, branch, elapsedMs) {
  const { repository, statistics, files, importantFiles, facts, drift } = result;
  const { codeFacts, documentationFacts, warnings } = facts;

  console.log(`\n${HR}`);
  console.log(`  CodeAtlas Analyzer — Validation Report`);
  console.log(HR);

  // ── Repository ──
  console.log('\n📦 REPOSITORY');
  console.log(HR2);
  console.log(`  ${pad('Full name:')}  ${repository.fullName}`);
  console.log(`  ${pad('Branch:')}     ${repository.branch}`);
  console.log(`  ${pad('Commit SHA:')} ${repository.commitSha}`);
  console.log(`  ${pad('Scan time:')}  ${elapsedMs}ms`);

  // ── File Statistics ──
  console.log('\n📁 FILE STATISTICS');
  console.log(HR2);
  console.log(`  ${pad('Total files in inventory:')}    ${statistics.totalFiles}`);
  console.log(`  ${pad('Source files:')}                ${statistics.sourceFiles}`);
  console.log(`  ${pad('Documentation files:')}         ${statistics.documentationFiles}`);
  console.log(`  ${pad('Configuration files:')}         ${statistics.configurationFiles}`);
  console.log(`  ${pad('Infrastructure files:')}        ${statistics.infrastructureFiles}`);
  console.log(`  ${pad('Build files:')}                 ${statistics.buildFiles}`);
  console.log(`  ${pad('Unknown files:')}               ${statistics.unknownFiles}`);
  console.log(`  ${pad('Skipped (binary):')}            ${statistics.skippedBinaryFiles}`);
  console.log(`  ${pad('Skipped (oversized):')}         ${statistics.skippedOversizedFiles}`);
  console.log(`  ${pad('Excluded (.env secrets):')}     ${statistics.excludedSecretFiles}`);

  // ── Important Files Detected ──
  const importantList = [];
  for (const [key, paths] of Object.entries(importantFiles || {})) {
    for (const p of (Array.isArray(paths) ? paths : [paths])) {
      if (p) importantList.push(p);
    }
  }
  if (importantList.length > 0) {
    console.log('\n  Notable files detected:');
    for (const p of importantList.sort()) {
      console.log(`    ✔  ${p}`);
    }
  }

  // ── Code Facts ──
  console.log('\n🔍 CODE FACTS');
  console.log(HR2);
  console.log(`  ${pad('API endpoints (from source/OpenAPI):')}   ${codeFacts.apiEndpoints.length}`);
  console.log(`  ${pad('Environment variables (from source):')}   ${codeFacts.environmentVariables.length}`);
  console.log(`  ${pad('Dependencies:')}                          ${codeFacts.dependencies.length}`);
  console.log(`  ${pad('Scripts:')}                               ${codeFacts.scripts.length}`);

  if (codeFacts.apiEndpoints.length > 0) {
    console.log('\n  Code API Endpoints:');
    const sorted = [...codeFacts.apiEndpoints].sort((a, b) => a.path.localeCompare(b.path));
    for (const ep of sorted) {
      const tag = ep.fromOpenApi ? ' [OpenAPI]' : ep.prefixResolved ? ' [prefix-resolved]' : '';
      console.log(`    ${ep.method.padEnd(7)} ${ep.path}${tag}`);
      console.log(`             ↳ ${ep.source}${ep.line ? ':' + ep.line : ''}`);
    }
  }

  if (codeFacts.environmentVariables.length > 0) {
    console.log('\n  Code Environment Variables:');
    const names = [...new Set(codeFacts.environmentVariables.map(v => v.name))].sort();
    for (const n of names) {
      const facts = codeFacts.environmentVariables.filter(v => v.name === n);
      const src = facts.map(f => f.source + (f.line ? ':' + f.line : '')).join(', ');
      const tag = facts.some(f => f.fromTemplate) ? ' [.env.example]' : '';
      console.log(`    ${n}${tag}`);
      console.log(`             ↳ ${src}`);
    }
  }

  if (codeFacts.dependencies.length > 0) {
    const runtimeDeps = codeFacts.dependencies.filter(d => d.section === 'dependencies');
    const devDeps     = codeFacts.dependencies.filter(d => d.section === 'devDependencies');
    console.log('\n  Dependencies:');
    if (runtimeDeps.length) {
      console.log(`    runtime (${runtimeDeps.length}): ${runtimeDeps.map(d => `${d.name}@${d.version}`).join(', ')}`);
    }
    if (devDeps.length) {
      console.log(`    dev     (${devDeps.length}): ${devDeps.map(d => `${d.name}@${d.version}`).join(', ')}`);
    }
  }

  if (codeFacts.scripts && codeFacts.scripts.length > 0) {
    console.log('\n  NPM Scripts:');
    for (const s of codeFacts.scripts) {
      console.log(`    ${s.name.padEnd(12)} → ${s.command}`);
    }
  }

  // ── Documentation Facts ──
  console.log('\n📄 DOCUMENTATION FACTS');
  console.log(HR2);
  console.log(`  ${pad('API endpoints (documented):')}     ${documentationFacts.apiEndpoints.length}`);
  console.log(`  ${pad('Environment variables (documented):')} ${documentationFacts.environmentVariables.length}`);

  if (documentationFacts.apiEndpoints.length > 0) {
    console.log('\n  Documented API Endpoints:');
    const sorted = [...documentationFacts.apiEndpoints].sort((a, b) => a.path.localeCompare(b.path));
    for (const ep of sorted) {
      const tag = ep.fromOpenApi ? ' [OpenAPI]' : ep.fromCurl ? ' [curl]' : '';
      console.log(`    ${ep.method.padEnd(7)} ${ep.path}${tag}`);
      console.log(`             ↳ ${ep.source}${ep.line ? ':' + ep.line : ''}`);
    }
  }

  if (documentationFacts.environmentVariables.length > 0) {
    console.log('\n  Documented Environment Variables:');
    const names = [...new Set(documentationFacts.environmentVariables.map(v => v.name))].sort();
    for (const n of names) {
      const facts = documentationFacts.environmentVariables.filter(v => v.name === n);
      const src = facts.map(f => f.source + (f.line ? ':' + f.line : '')).join(', ');
      console.log(`    ${n}`);
      console.log(`             ↳ ${src}`);
    }
  }

  // ── Extraction Warnings ──
  if (warnings && warnings.length > 0) {
    console.log('\n⚠️  EXTRACTION WARNINGS');
    console.log(HR2);
    for (const w of warnings) {
      console.log(`  ⚠  ${w}`);
    }
  }

  // ── Drift Findings ──
  console.log('\n🔄 DRIFT FINDINGS');
  console.log(HR2);
  console.log(`  ${pad('Total findings:')}   ${drift.summary.total}`);
  console.log(`  ${pad('HIGH:')}             ${drift.summary.high}`);
  console.log(`  ${pad('MEDIUM:')}           ${drift.summary.medium}`);
  console.log(`  ${pad('LOW:')}              ${drift.summary.low}`);

  if (drift.findings.length === 0) {
    console.log('\n  ✅ No drift detected.');
  } else {
    const bySeverity = { HIGH: [], MEDIUM: [], LOW: [] };
    for (const f of drift.findings) {
      bySeverity[f.severity].push(f);
    }

    for (const severity of ['HIGH', 'MEDIUM', 'LOW']) {
      const group = bySeverity[severity];
      if (group.length === 0) continue;

      const icon = severity === 'HIGH' ? '🔴' : severity === 'MEDIUM' ? '🟡' : '🟢';
      console.log(`\n  ${icon} ${severity} (${group.length})`);
      console.log(`  ${HR3.slice(0, 60)}`);

      for (let i = 0; i < group.length; i++) {
        const f = group[i];
        console.log(`\n  [${severity}-${String(i + 1).padStart(2, '0')}] ${f.type}`);
        console.log(`  Title:   ${f.title}`);
        console.log(`  Message: ${f.message}`);

        // Resource
        if (f.resource.method) {
          console.log(`  Resource: ${f.resource.method} ${f.resource.path}`);
        } else if (f.resource.name) {
          console.log(`  Resource: ${f.resource.name}`);
        }

        // Code evidence
        if (f.codeEvidence) {
          const ce = f.codeEvidence;
          const extras = [];
          if (ce.prefixResolved) extras.push('prefix-resolved');
          if (ce.fromOpenApi) extras.push('OpenAPI');
          const extraStr = extras.length ? ` (${extras.join(', ')})` : '';
          console.log(`  Code evidence: ${ce.source}${ce.line ? ':' + ce.line : ''}${extraStr}`);
        } else {
          console.log(`  Code evidence: none`);
        }

        // Documentation evidence
        if (f.documentationEvidence) {
          const de = f.documentationEvidence;
          const extras = [];
          if (de.fromOpenApi) extras.push('OpenAPI');
          if (de.fromCurl) extras.push('curl');
          const extraStr = extras.length ? ` (${extras.join(', ')})` : '';
          console.log(`  Doc evidence:  ${de.source}${de.line ? ':' + de.line : ''}${extraStr}`);
        } else {
          console.log(`  Doc evidence:  none`);
        }
      }
    }
  }

  console.log(`\n${HR}`);
  console.log(`  Scan complete: ${repository.fullName} @ ${new Date().toISOString()}`);
  console.log(HR);
  console.log();
}

// ─────────────────────────────────────────────
// 3. Main entry point
// ─────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const rawUrl = args[0];
  const branch = args[1] || null; // null = let scanner try 'main' then fall back

  const { owner, repo } = parseGitHubUrl(rawUrl);

  console.log(`\nCodeAtlas Analyzer — Validating: ${owner}/${repo}`);
  console.log(`Branch: ${branch || 'auto (main → master fallback)'}`);
  console.log(`Starting pipeline...\n`);

  const provider = new GitHubRepositoryProvider();
  const scanner  = new RepositoryScanner(provider);

  const startMs = Date.now();

  // Try specified branch; if not given, try 'main' then 'master'
  let result;
  const branchesToTry = branch ? [branch] : ['main', 'master'];

  for (let i = 0; i < branchesToTry.length; i++) {
    const b = branchesToTry[i];
    const isLast = i === branchesToTry.length - 1;

    try {
      console.log(`  → Trying branch: ${b}`);
      result = await scanner.scan(owner, repo, b);
      console.log(`  ✔ Branch resolved: ${b}\n`);
      break;
    } catch (err) {
      // GitHub returns 404 or 422 when a branch doesn't exist
      const isRetryableCode = err.statusCode === 404 || err.statusCode === 422 || err.statusCode === 400;
      if (!isLast && isRetryableCode) {
        console.log(`    Branch "${b}" not available (HTTP ${err.statusCode}), trying next...`);
        continue;
      }

      if (err.statusCode === 429) {
        console.error('\n❌ GitHub API rate limit exceeded.');
        console.error('   Set a GITHUB_TOKEN in your environment or wait and retry.');
        process.exit(1);
      }
      if (err.statusCode === 504) {
        console.error('\n❌ Request timed out. GitHub may be slow or the repository tree is very large.');
        process.exit(1);
      }
      if (err.statusCode === 502) {
        console.error(`\n❌ Network error: ${err.message}`);
        process.exit(1);
      }
      if (err.statusCode === 404 || err.statusCode === 422) {
        console.error(`\n❌ Repository "${owner}/${repo}" not found or branch "${b}" doesn't exist.`);
        process.exit(1);
      }

      console.error(`\n❌ Error (status ${err.statusCode || 'unknown'}): ${err.message}`);
      process.exit(1);
    }
  }

  if (!result) {
    console.error('\n❌ Could not resolve any branch for this repository.');
    process.exit(1);
  }

  const elapsedMs = Date.now() - startMs;

  printReport(result, owner, repo, branch, elapsedMs);
}

main().catch((err) => {
  console.error(`\n❌ Fatal error: ${err.message}`);
  process.exit(1);
});
