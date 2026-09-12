'use strict';

const { execFileSync } = require('child_process');
const { publish } = require('./homey.cjs');
const { version } = require('../../app.json');

// Recover the Homey publish step after semantic-release has already pushed its
// tag. Require that exact release checkout, so a retry cannot upload newer code.
const tagOutput = execFileSync('git', ['tag', '--points-at', 'HEAD'], {
    encoding: 'utf8',
});
const releaseTags = tagOutput.trim().split('\n');
const workingTreeStatus = execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
});
const hasUncommittedChanges = workingTreeStatus.trim().length > 0;

if (!releaseTags.includes(`v${version}`) || hasUncommittedChanges) {
    throw new Error(`Retry requires a clean checkout of v${version}.`);
}

const releaseContext = {
    cwd: process.cwd(),
    env: process.env,
    nextRelease: {
        version,
    },
    logger: console,
};

publish({}, releaseContext).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
