/**
 * Live GitHub Repository Provider Integration Test
 */

const { analyzePublicRepository } = require('../src/index');

async function testLiveGitHubIntegration() {
  console.log('\n--- Live GitHub Integration Test ---');

  try {
    const result = await analyzePublicRepository('octocat', 'Hello-World', 'master');
    console.log(`  Target: ${result.repository.fullName} (${result.repository.branch})`);
    console.log(`  Commit SHA: ${result.repository.commitSha}`);
    console.log(`  Files scanned: ${result.statistics.totalFiles}`);
    console.log(`  Documentation files: ${result.statistics.documentationFiles}`);
    console.log(`  Important files (README): ${result.importantFiles.readme.join(', ')}`);

    if (result.repository.fullName !== 'octocat/Hello-World') {
      throw new Error('Live GitHub repo fullName mismatch');
    }
    if (!result.importantFiles.readme.includes('README')) {
      throw new Error('Expected README in octocat/Hello-World');
    }

    console.log('  ✅ Live GitHub public repository analysis succeeded!\n');
  } catch (err) {
    if (err.statusCode === 429) {
      console.log('  ⚠️ GitHub API rate limit reached for unauthenticated IP. Skipping live test.');
    } else {
      throw err;
    }
  }
}

testLiveGitHubIntegration().catch((err) => {
  console.error('❌ Live GitHub Test Failed:', err);
  process.exit(1);
});
