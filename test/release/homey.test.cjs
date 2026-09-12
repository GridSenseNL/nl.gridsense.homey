'use strict';

const assert = require('assert/strict');
const { test } = require('node:test');
const {
    mkdtemp,
    mkdir,
    writeFile,
    readFile,
    rm,
} = require('fs/promises');
const path = require('path');
const os = require('os');
const {
    verifyConditions,
    verifyRelease,
    publishToTest,
    writeReleaseMetadata,
} = require('../../scripts/release/homey.cjs');

const version = '1.1.0';
const silentLogger = {
    log() {},
};

async function createAppFixture(testContext) {
    const workingDirectory = await mkdtemp(path.join(os.tmpdir(), 'homey-release-'));

    testContext.after(() => rm(workingDirectory, {
        recursive: true,
        force: true,
    }));

    await mkdir(path.join(workingDirectory, '.homeycompose'));

    const fixtureFiles = {
        '.homeycompose/app.json': {
            id: 'nl.gridsense.homey',
            version: '1.0.2',
            platforms: ['local'],
        },
        'app.json': {
            id: 'nl.gridsense.homey',
            version: '1.0.2',
            drivers: [{ id: 'gateway' }],
        },
        'package.json': {
            name: 'nl.gridsense.homey',
            version: '1.0.0',
        },
        'package-lock.json': {
            version: '1.0.0',
            packages: {
                '': {
                    version: '1.0.0',
                },
                dependency: {
                    version: '9.0.0',
                },
            },
        },
        '.homeychangelog.json': {
            '1.0.2': {
                en: 'Local support only.',
                nl: 'Alleen lokaal.',
            },
        },
    };

    for (const [fileName, contents] of Object.entries(fixtureFiles)) {
        const filePath = path.join(workingDirectory, fileName);
        await writeFile(filePath, JSON.stringify(contents));
    }

    async function readFixtureFile(fileName) {
        const filePath = path.join(workingDirectory, fileName);
        const fileContents = await readFile(filePath, 'utf8');

        return JSON.parse(fileContents);
    }

    return {
        workingDirectory,
        readFixtureFile,
    };
}

test('updates release metadata together and preserves history and application data', async (testContext) => {
    const { workingDirectory, readFixtureFile } = await createAppFixture(testContext);
    const notes = '### Features\n\n* Preserve "quotes", `backticks` and $(commands) as text.\n';

    await writeReleaseMetadata(workingDirectory, {
        version,
        notes,
    });

    const manifestFiles = [
        '.homeycompose/app.json',
        'app.json',
        'package.json',
        'package-lock.json',
    ];

    for (const fileName of manifestFiles) {
        const manifest = await readFixtureFile(fileName);
        assert.equal(manifest.version, version);
    }

    const appManifest = await readFixtureFile('app.json');
    const composeManifest = await readFixtureFile('.homeycompose/app.json');
    const packageLock = await readFixtureFile('package-lock.json');
    const changelog = await readFixtureFile('.homeychangelog.json');

    assert.deepEqual(appManifest.drivers, [{ id: 'gateway' }]);
    assert.deepEqual(composeManifest.platforms, ['local']);
    assert.equal(packageLock.packages[''].version, version);
    assert.equal(packageLock.packages.dependency.version, '9.0.0');
    assert.deepEqual(changelog, {
        '1.0.2': {
            en: 'Local support only.',
            nl: 'Alleen lokaal.',
        },
        [version]: {
            en: notes.trim(),
        },
    });
});

test('requires a Homey token and rejects missing tags, reused versions and prereleases', async (testContext) => {
    assert.throws(() => verifyConditions({}, { env: {} }), /HOMEY_PAT/);

    const { workingDirectory } = await createAppFixture(testContext);
    const invalidVersions = ['1.0.0', '1.0.2', '1.1.0-beta.1', 'bad'];

    for (const invalidVersion of invalidVersions) {
        const releaseContext = {
            cwd: workingDirectory,
            nextRelease: {
                version: invalidVersion,
                notes: 'Fix',
            },
        };

        await assert.rejects(verifyRelease({}, releaseContext), /must exceed/);
    }

    // semantic-release verifies the version before generating release notes.
    await verifyRelease({}, {
        cwd: workingDirectory,
        nextRelease: {
            version,
        },
    });

    const releaseWithoutNotes = {
        version,
        notes: '',
    };

    await assert.rejects(
        writeReleaseMetadata(workingDirectory, releaseWithoutNotes),
        /must not be empty/,
    );
});

function createPublisherScenario(buildStates, { existing = false, attempts = 6 } = {}) {
    let buildExists = existing;
    let uploadCount = 0;
    let buildReadCount = 0;
    const promotionRequests = [];

    function nextBuildResponse() {
        const stateIndex = Math.min(buildReadCount, buildStates.length - 1);
        buildReadCount += 1;

        return {
            id: 'build-123',
            version,
            state: buildStates[stateIndex],
        };
    }

    const fakeApi = {
        async getBuilds() {
            return buildExists ? [nextBuildResponse()] : [];
        },
        async getBuild() {
            return nextBuildResponse();
        },
        async updateBuildChannel(request) {
            promotionRequests.push(request);
        },
    };

    return {
        fakeApi,
        promotionRequests,
        getUploadCount: () => uploadCount,
        run: () => publishToTest({
            api: fakeApi,
            token: 'test-token',
            appId: 'nl.gridsense.homey',
            version,
            upload: async () => {
                buildExists = true;
                uploadCount += 1;
            },
            logger: silentLogger,
            wait: async () => {},
            attempts,
        }),
    };
}

test('uploads once, waits for processing and promotes the exact build to Test', async () => {
    const publisherScenario = createPublisherScenario([
        'waiting_for_files',
        'processing',
        'draft',
        'test',
    ]);
    const publishedRelease = await publisherScenario.run();

    assert.deepEqual(publishedRelease, {
        name: 'Homey Test',
        url: 'https://homey.app/a/nl.gridsense.homey/test/',
    });
    assert.equal(publisherScenario.getUploadCount(), 1);
    assert.deepEqual(publisherScenario.promotionRequests, [{
        $token: 'test-token',
        appId: 'nl.gridsense.homey',
        buildId: 'build-123',
        channel: 'test',
    }]);
});

test('resumes an existing draft without uploading it again', async () => {
    const publisherScenario = createPublisherScenario(['draft', 'draft', 'test'], {
        existing: true,
    });

    await publisherScenario.run();

    assert.equal(publisherScenario.getUploadCount(), 0);
    assert.equal(publisherScenario.promotionRequests.length, 1);
});

test('already published Test build is a no-op', async () => {
    const publisherScenario = createPublisherScenario(['test'], {
        existing: true,
    });

    await publisherScenario.run();

    assert.equal(publisherScenario.getUploadCount(), 0);
    assert.deepEqual(publisherScenario.promotionRequests, []);
});

test('failed, live, superseded and unknown builds are never promoted', async () => {
    const rejectedBuildStates = ['processing_failed', 'live', 'superseded', 'unexpected'];

    for (const buildState of rejectedBuildStates) {
        const publisherScenario = createPublisherScenario([buildState], {
            existing: true,
        });

        await assert.rejects(publisherScenario.run(), /inspect the developer portal/);

        assert.deepEqual(publisherScenario.promotionRequests, []);
        assert.equal(publisherScenario.getUploadCount(), 0);
    }
});

test('processing has a bounded timeout', async () => {
    const publisherScenario = createPublisherScenario(['processing']);

    await assert.rejects(publisherScenario.run(), /Timed out/);

    assert.equal(publisherScenario.getUploadCount(), 1);
    assert.deepEqual(publisherScenario.promotionRequests, []);
});

test('API failures propagate instead of reporting a successful release', async () => {
    const publisherScenario = createPublisherScenario(['draft'], {
        existing: true,
    });

    publisherScenario.fakeApi.updateBuildChannel = async () => {
        throw new Error('Forbidden');
    };

    await assert.rejects(publisherScenario.run(), /Forbidden/);
});

test('ambiguous or mismatched versions cannot be promoted', async () => {
    const publisherScenario = createPublisherScenario(['draft'], {
        existing: true,
    });

    publisherScenario.fakeApi.getBuilds = async () => [{ version }, { version }];
    await assert.rejects(publisherScenario.run(), /Multiple/);

    publisherScenario.fakeApi.getBuilds = async () => [{
        version,
        id: '123',
    }];
    publisherScenario.fakeApi.getBuild = async () => ({
        version: '2.0.0',
        state: 'draft',
    });
    await assert.rejects(publisherScenario.run(), /different build version/);

    assert.deepEqual(publisherScenario.promotionRequests, []);
});

test('Conventional Commits determine releases and notes from the existing tag', async () => {
    const { analyzeCommits } = await import('@semantic-release/commit-analyzer');
    const { generateNotes } = await import('@semantic-release/release-notes-generator');
    const commitExamples = [
        ['fix: reconnect gateway', 'patch'],
        ['feat: support battery', 'minor'],
        ['feat: change discovery\n\nBREAKING CHANGE: old gateways are no longer supported', 'major'],
        ['docs: update setup', null],
        ['chore(release): 1.0.2 [skip ci]', null],
    ];

    for (const [message, expectedReleaseType] of commitExamples) {
        const releaseType = await analyzeCommits({}, {
            commits: [{ message }],
            logger: silentLogger,
        });

        assert.equal(releaseType, expectedReleaseType);
    }

    const releaseNotes = await generateNotes({}, {
        cwd: process.cwd(),
        commits: [{
            message: 'feat: support battery',
            hash: '1234567890123456789012345678901234567890',
        }],
        lastRelease: {
            version: '1.0.2',
            gitTag: 'v1.0.2',
        },
        nextRelease: {
            version,
            gitTag: `v${version}`,
        },
        options: {
            repositoryUrl: 'https://git.zsinfo.nl/gridsense/nl.gridsense.homey.git',
        },
    });

    assert.match(releaseNotes, /support battery/);
    assert.match(releaseNotes, /v1\.0\.2\.\.\.v1\.1\.0/);
});
