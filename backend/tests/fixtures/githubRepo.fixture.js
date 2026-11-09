/**
 * GitHub Repository Fixture
 * Deterministic responses for githubService mocking.
 */

module.exports = {
  mockGitHubRepoData: {
    githubRepositoryId: '12345678',
    name: 'node-express-boilerplate',
    fullName: 'testuser/node-express-boilerplate',
    owner: 'testuser',
    description: 'A boilerplate for building production-ready RESTful APIs using Node.js, Express, and Mongoose',
    htmlUrl: 'https://github.com/testuser/node-express-boilerplate',
    url: 'https://api.github.com/repos/testuser/node-express-boilerplate',
    defaultBranch: 'master',
    stars: 3500,
    forks: 1200,
    openIssues: 15,
    language: 'JavaScript',
    private: false,
    updatedAt: '2026-11-01T12:00:00Z',
  },
  mockCommitSha: '179ae84efec61b14206d0305d941daed6c6d07f9',
};
