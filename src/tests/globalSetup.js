const { execSync } = require('child_process');
const path = require('path');

const composeFile = path.join(__dirname, '../../docker-compose.test.yml');

// Tests create, update, and delete data, so locally they run against a throwaway Docker MySQL
// instead of the dev database. CI (or an explicit DB_PORT) provides its own database.
module.exports = async () => {
  if (process.env.CI || process.env.DB_PORT) {
    return;
  }

  execSync(`docker compose -f "${composeFile}" up -d --wait --force-recreate`, { stdio: 'inherit' });
  process.env.DB_PORT = '3307';
  process.env.DB_PASSWORD = 'tempdbpassword';
  process.env.TEST_DB_STARTED = 'true';
};
