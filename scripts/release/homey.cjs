'use strict';

const { readFile, writeFile } = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { setTimeout: sleep } = require('timers/promises');
const { AthomAppsAPI, AthomCloudAPI } = require('homey-api');
const semver = require('semver');

const readJson = async (cwd, file) => JSON.parse(await readFile(path.join(cwd, file), 'utf8'));
const writeJson = (cwd, file, data) => writeFile(path.join(cwd, file), `${JSON.stringify(data, null, 2)}\n`);

function runHomey(args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [require.resolve('homey/bin/homey.mjs'), 'app', ...args], {
      cwd,
      env: { ...env, HOMEY_HEADLESS: '1' },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Homey ${args[0]} failed (${signal || code}).`));
    });
  });
}

function verifyConditions(_config, { env }) {
  if (!env.HOMEY_PAT) throw new Error('HOMEY_PAT must be set to publish to Homey Test.');
}

async function verifyRelease(_config, { cwd, nextRelease }) {
  const manifest = await readJson(cwd, '.homeycompose/app.json');
  if (!semver.valid(nextRelease.version) || semver.prerelease(nextRelease.version)
    || !semver.gt(nextRelease.version, manifest.version)) {
    throw new Error(`Release ${nextRelease.version} must exceed Homey ${manifest.version}. Check the existing v* tags.`);
  }
}

async function writeReleaseMetadata(cwd, { version, notes }) {
  if (!notes || !notes.trim()) throw new Error('Release notes must not be empty.');
  for (const file of ['.homeycompose/app.json', 'app.json', 'package.json', 'package-lock.json']) {
    const data = await readJson(cwd, file);
    data.version = version;
    if (file === 'package-lock.json') data.packages[''].version = version;
    await writeJson(cwd, file, data);
  }
  const changelog = await readJson(cwd, '.homeychangelog.json');
  changelog[version] = { en: notes.trim() };
  await writeJson(cwd, '.homeychangelog.json', changelog);
}

async function prepare(_config, context) {
  await writeReleaseMetadata(context.cwd, context.nextRelease);
  // Recompose and validate the versioned app before semantic-release commits or tags it.
  await runHomey(['validate', '--level', 'verified'], context);
}

// The CLI creates a draft. This is the same API operation as the developer
// portal's "Publish to Test" button. Never submit for certification or Live.
async function publishToTest({
  api, token, appId, version, upload, logger, wait = sleep, attempts = 60,
}) {
  const auth = { $token: token, appId };
  const builds = await api.getBuilds(auth);
  const matches = builds.filter((build) => build.version === version);
  if (matches.length > 1) throw new Error(`Multiple Homey builds found for ${version}; inspect the developer portal.`);
  let build = matches[0];
  if (!build) await upload();

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (build) {
      build = await api.getBuild({ ...auth, buildId: build.id });
    } else {
      const uploaded = (await api.getBuilds(auth)).filter((item) => item.version === version);
      if (uploaded.length > 1) throw new Error(`Multiple Homey builds found for ${version}.`);
      [build] = uploaded;
    }
    if (build) {
      if (build.version !== version) throw new Error('Homey returned a different build version.');
      if (build.state === 'test') {
        logger.log(`Homey ${version} is available on Test.`);
        return { name: 'Homey Test', url: `https://homey.app/a/${appId}/test/` };
      }
      if (build.state === 'draft') {
        await api.updateBuildChannel({ ...auth, buildId: build.id, channel: 'test' });
      } else if (!['waiting_for_files', 'processing'].includes(build.state)) {
        throw new Error(`Homey build ${build.id} is ${build.state}; inspect the developer portal before retrying.`);
      }
      logger.log(`Waiting for Homey build ${build.id} (${build.state})...`);
    }
    await wait(10000);
  }
  throw new Error(`Timed out waiting for Homey ${version} to reach Test; inspect the developer portal before retrying.`);
}

async function publish(_config, context) {
  verifyConditions(_config, context);
  const { id: appId, version } = await readJson(context.cwd, 'app.json');
  if (version !== context.nextRelease.version) throw new Error('Homey manifest and release versions differ.');
  const cloud = new AthomCloudAPI({
    autoRefreshTokens: false,
    token: new AthomCloudAPI.Token({ access_token: context.env.HOMEY_PAT }),
  });
  const token = await cloud.createDelegationToken({ audience: 'apps' });
  return publishToTest({
    api: new AthomAppsAPI(),
    token,
    appId,
    version,
    upload: () => runHomey(['publish'], context),
    logger: context.logger,
  });
}

module.exports = {
  verifyConditions, verifyRelease, prepare, publish, publishToTest, writeReleaseMetadata,
};
