const { execSync } = require('child_process');
const path = require('path');

const composeFile = path.join(__dirname, '../../docker-compose.test.yml');

module.exports = async () => {
  if (process.env.TEST_DB_STARTED) {
    execSync(`docker compose -f "${composeFile}" down`, { stdio: 'inherit' });
  }
};
