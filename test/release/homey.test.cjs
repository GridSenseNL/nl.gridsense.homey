'use strict';

const assert = require('assert/strict');
const { test } = require('node:test');
const {
  mkdtemp, mkdir, writeFile, readFile, rm,
} = require('fs/promises');
const path = require('path');
const os = require('os');
const {
  verifyConditions, verifyRelease, publishToTest, writeReleaseMetadata,
} = require('../../scripts/release/homey.cjs');

const version = '1.1.0';
const logger = { log() {} };

async function fixture(t) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'homey-release-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, '.homeycompose'));
  const files = {
    '.homeycompose/app.json': { id: 'nl.gridsense.homey', version: '1.0.2', platforms: ['local'] },
    'app.json': { id: 'nl.gridsense.homey', version: '1.0.2', drivers: [{ id: 'gateway' }] },
    'package.json': { name: 'nl.gridsense.homey', version: '1.0.0' },
    'package-lock.json': { version: '1.0.0', packages: { '': { version: '1.0.0' }, dependency: { version: '9.0.0' } } },
    '.homeychangelog.json': { '1.0.2': { en: 'Local support only.', nl: 'Alleen lokaal.' } },
  };
  for (const [file, data] of Object.entries(files)) {
    await writeFile(path.join(cwd, file), JSON.stringify(data));
  }
  return { cwd, read: async (file) => JSON.parse(await readFile(path.join(cwd, file), 'utf8')) };
}

test('updates release metadata together and preserves history and application data', async (t) => {
  const { cwd, read } = await fixture(t);
  const notes = '### Features\n\n* Preserve "quotes", `backticks` and $(commands) as text.\n';
  await writeReleaseMetadata(cwd, { version, notes });
  for (const file of ['.homeycompose/app.json', 'app.json', 'package.json', 'package-lock.json']) {
    assert.equal((await read(file)).version, version);
  }
  assert.deepEqual((await read('app.json')).drivers, [{ id: 'gateway' }]);
  assert.deepEqual((await read('.homeycompose/app.json')).platforms, ['local']);
  const lock = await read('package-lock.json');
  assert.equal(lock.packages[''].version, version);
  assert.equal(lock.packages.dependency.version, '9.0.0');
  assert.deepEqual(await read('.homeychangelog.json'), {
    '1.0.2': { en: 'Local support only.', nl: 'Alleen lokaal.' },
    [version]: { en: notes.trim() },
  });
});

test('requires a Homey token and rejects missing tags, reused versions and prereleases', async (t) => {
  assert.throws(() => verifyConditions({}, { env: {} }), /HOMEY_PAT/);
  const { cwd } = await fixture(t);
  for (const invalid of ['1.0.0', '1.0.2', '1.1.0-beta.1', 'bad']) {
    await assert.rejects(verifyRelease({}, { cwd, nextRelease: { version: invalid, notes: 'Fix' } }), /must exceed/);
  }
  // semantic-release verifies the version before generating release notes.
  await verifyRelease({}, { cwd, nextRelease: { version } });
  await assert.rejects(writeReleaseMetadata(cwd, { version, notes: '' }), /must not be empty/);
});

function publisher(states, { existing = false, attempts = 6 } = {}) {
  let uploaded = existing;
  let uploads = 0;
  let reads = 0;
  const promotions = [];
  const build = () => ({ id: 'build-123', version, state: states[Math.min(reads++, states.length - 1)] });
  const api = {
    async getBuilds() {
      return uploaded ? [build()] : [];
    },
    async getBuild() {
      return build();
    },
    async updateBuildChannel(args) {
      promotions.push(args);
    },
  };
  return {
    api,
    promotions,
    uploads: () => uploads,
    run: () => publishToTest({
      api,
      token: 'test-token',
      appId: 'nl.gridsense.homey',
      version,
      upload: async () => {
        uploaded = true; uploads += 1;
      },
      logger,
      wait: async () => {},
      attempts,
    }),
  };
}

test('uploads once, waits for processing and promotes the exact build to Test', async () => {
  const p = publisher(['waiting_for_files', 'processing', 'draft', 'test']);
  assert.deepEqual(await p.run(), { name: 'Homey Test', url: 'https://homey.app/a/nl.gridsense.homey/test/' });
  assert.equal(p.uploads(), 1);
  assert.deepEqual(p.promotions, [{
    $token: 'test-token', appId: 'nl.gridsense.homey', buildId: 'build-123', channel: 'test',
  }]);
});

test('resumes an existing draft without uploading it again', async () => {
  const p = publisher(['draft', 'draft', 'test'], { existing: true });
  await p.run();
  assert.equal(p.uploads(), 0);
  assert.equal(p.promotions.length, 1);
});

test('already published Test build is a no-op', async () => {
  const p = publisher(['test'], { existing: true });
  await p.run();
  assert.equal(p.uploads(), 0);
  assert.deepEqual(p.promotions, []);
});

test('failed, live, superseded and unknown builds are never promoted', async () => {
  for (const state of ['processing_failed', 'live', 'superseded', 'unexpected']) {
    const p = publisher([state], { existing: true });
    await assert.rejects(p.run(), /inspect the developer portal/);
    assert.deepEqual(p.promotions, []);
    assert.equal(p.uploads(), 0);
  }
});

test('processing has a bounded timeout', async () => {
  const p = publisher(['processing']);
  await assert.rejects(p.run(), /Timed out/);
  assert.equal(p.uploads(), 1);
  assert.deepEqual(p.promotions, []);
});

test('API failures propagate instead of reporting a successful release', async () => {
  const p = publisher(['draft'], { existing: true });
  p.api.updateBuildChannel = async () => {
    throw new Error('Forbidden');
  };
  await assert.rejects(p.run(), /Forbidden/);
});

test('ambiguous or mismatched versions cannot be promoted', async () => {
  const p = publisher(['draft'], { existing: true });
  p.api.getBuilds = async () => [{ version }, { version }];
  await assert.rejects(p.run(), /Multiple/);
  p.api.getBuilds = async () => [{ version, id: '123' }];
  p.api.getBuild = async () => ({ version: '2.0.0', state: 'draft' });
  await assert.rejects(p.run(), /different build version/);
  assert.deepEqual(p.promotions, []);
});

test('Conventional Commits determine releases and notes from the existing tag', async () => {
  const { analyzeCommits } = await import('@semantic-release/commit-analyzer');
  const { generateNotes } = await import('@semantic-release/release-notes-generator');
  for (const [message, expected] of [
    ['fix: reconnect gateway', 'patch'],
    ['feat: support battery', 'minor'],
    ['feat: change discovery\n\nBREAKING CHANGE: old gateways are no longer supported', 'major'],
    ['docs: update setup', null],
    ['chore(release): 1.0.2 [skip ci]', null],
  ]) {
    assert.equal(await analyzeCommits({}, { commits: [{ message }], logger }), expected);
  }
  const notes = await generateNotes({}, {
    cwd: process.cwd(),
    commits: [{ message: 'feat: support battery', hash: '1234567890123456789012345678901234567890' }],
    lastRelease: { version: '1.0.2', gitTag: 'v1.0.2' },
    nextRelease: { version, gitTag: `v${version}` },
    options: { repositoryUrl: 'https://git.zsinfo.nl/gridsense/nl.gridsense.homey.git' },
  });
  assert.match(notes, /support battery/);
  assert.match(notes, /v1\.0\.2\.\.\.v1\.1\.0/);
});
