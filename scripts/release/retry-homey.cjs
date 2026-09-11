'use strict';

const { execFileSync } = require('child_process');
const { publish } = require('./homey.cjs');
const { version } = require('../../app.json');

// Recover the Homey publish step after semantic-release has already pushed its
// tag. Require that exact release checkout, so a retry cannot upload newer code.
const tags = execFileSync('git', ['tag', '--points-at', 'HEAD'], { encoding: 'utf8' }).trim().split('\n');
const changes = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (!tags.includes(`v${version}`) || changes) {
  throw new Error(`Retry requires a clean checkout of v${version}.`);
}

publish({}, {
  cwd: process.cwd(),
  env: process.env,
  nextRelease: { version },
  logger: console,
}).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
