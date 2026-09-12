'use strict';

const { readFile, writeFile } = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { setTimeout: sleep } = require('timers/promises');
const { AthomAppsAPI, AthomCloudAPI } = require('homey-api');
const semver = require('semver');

async function readJson(workingDirectory, fileName) {
    const filePath = path.join(workingDirectory, fileName);
    const fileContents = await readFile(filePath, 'utf8');

    return JSON.parse(fileContents);
}

async function writeJson(workingDirectory, fileName, contents) {
    const filePath = path.join(workingDirectory, fileName);
    const formattedJson = JSON.stringify(contents, null, 2);

    await writeFile(filePath, `${formattedJson}\n`);
}

function runHomey(commandArguments, context) {
    const executablePath = require.resolve('homey/bin/homey.mjs');
    const processArguments = [executablePath, 'app', ...commandArguments];
    const processOptions = {
        cwd: context.cwd,
        env: {
            ...context.env,
            HOMEY_HEADLESS: '1',
        },
        stdio: 'inherit',
    };

    return new Promise((resolve, reject) => {
        const homeyProcess = spawn(process.execPath, processArguments, processOptions);

        homeyProcess.on('error', reject);
        homeyProcess.on('exit', (exitCode, signal) => {
            if (exitCode === 0) {
                resolve();
            } else {
                const commandName = commandArguments[0];
                const failureReason = signal || exitCode;

                reject(new Error(`Homey ${commandName} failed (${failureReason}).`));
            }
        });
    });
}

function verifyConditions(_pluginConfig, context) {
    if (!context.env.HOMEY_PAT) {
        throw new Error('HOMEY_PAT must be set to publish to Homey Test.');
    }
}

async function verifyRelease(_pluginConfig, context) {
    const manifest = await readJson(context.cwd, '.homeycompose/app.json');
    const releaseVersion = context.nextRelease.version;

    if (
        !semver.valid(releaseVersion)
        || semver.prerelease(releaseVersion)
        || !semver.gt(releaseVersion, manifest.version)
    ) {
        throw new Error(
            `Release ${releaseVersion} must exceed Homey ${manifest.version}. Check the existing v* tags.`,
        );
    }
}

async function writeReleaseMetadata(workingDirectory, nextRelease) {
    const { version, notes } = nextRelease;

    if (!notes || !notes.trim()) {
        throw new Error('Release notes must not be empty.');
    }

    const manifestFiles = [
        '.homeycompose/app.json',
        'app.json',
        'package.json',
        'package-lock.json',
    ];

    for (const fileName of manifestFiles) {
        const manifest = await readJson(workingDirectory, fileName);
        manifest.version = version;

        if (fileName === 'package-lock.json') {
            manifest.packages[''].version = version;
        }

        await writeJson(workingDirectory, fileName, manifest);
    }

    const changelog = await readJson(workingDirectory, '.homeychangelog.json');
    changelog[version] = {
        en: notes.trim(),
    };

    await writeJson(workingDirectory, '.homeychangelog.json', changelog);
}

async function prepare(_pluginConfig, context) {
    await writeReleaseMetadata(context.cwd, context.nextRelease);

    // Recompose and validate the versioned app before semantic-release commits or tags it.
    await runHomey(['validate', '--level', 'verified'], context);
}

// The CLI creates a draft. This is the same API operation as the developer
// portal's "Publish to Test" button. Never submit for certification or Live.
async function publishToTest({
    api,
    token,
    appId,
    version,
    upload,
    logger,
    wait = sleep,
    attempts = 60,
}) {
    const authenticatedApp = {
        $token: token,
        appId,
    };
    const existingBuilds = await api.getBuilds(authenticatedApp);
    const matchingBuilds = existingBuilds.filter((build) => build.version === version);

    if (matchingBuilds.length > 1) {
        throw new Error(`Multiple Homey builds found for ${version}; inspect the developer portal.`);
    }

    let releaseBuild = matchingBuilds[0];

    if (!releaseBuild) {
        await upload();
    }

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (releaseBuild) {
            releaseBuild = await api.getBuild({
                ...authenticatedApp,
                buildId: releaseBuild.id,
            });
        } else {
            const availableBuilds = await api.getBuilds(authenticatedApp);
            const uploadedBuilds = availableBuilds.filter((build) => build.version === version);

            if (uploadedBuilds.length > 1) {
                throw new Error(`Multiple Homey builds found for ${version}.`);
            }

            [releaseBuild] = uploadedBuilds;
        }

        if (releaseBuild) {
            if (releaseBuild.version !== version) {
                throw new Error('Homey returned a different build version.');
            }

            if (releaseBuild.state === 'test') {
                logger.log(`Homey ${version} is available on Test.`);

                return {
                    name: 'Homey Test',
                    url: `https://homey.app/a/${appId}/test/`,
                };
            }

            if (releaseBuild.state === 'draft') {
                await api.updateBuildChannel({
                    ...authenticatedApp,
                    buildId: releaseBuild.id,
                    channel: 'test',
                });
            } else if (!['waiting_for_files', 'processing'].includes(releaseBuild.state)) {
                throw new Error(
                    `Homey build ${releaseBuild.id} is ${releaseBuild.state}; inspect the developer portal before retrying.`,
                );
            }

            logger.log(`Waiting for Homey build ${releaseBuild.id} (${releaseBuild.state})...`);
        }

        await wait(10000);
    }

    throw new Error(
        `Timed out waiting for Homey ${version} to reach Test; inspect the developer portal before retrying.`,
    );
}

async function publish(pluginConfig, context) {
    verifyConditions(pluginConfig, context);

    const { id: appId, version } = await readJson(context.cwd, 'app.json');

    if (version !== context.nextRelease.version) {
        throw new Error('Homey manifest and release versions differ.');
    }

    const cloudApi = new AthomCloudAPI({
        autoRefreshTokens: false,
        token: new AthomCloudAPI.Token({
            access_token: context.env.HOMEY_PAT,
        }),
    });
    const delegationToken = await cloudApi.createDelegationToken({
        audience: 'apps',
    });

    return publishToTest({
        api: new AthomAppsAPI(),
        token: delegationToken,
        appId,
        version,
        upload: () => runHomey(['publish'], context),
        logger: context.logger,
    });
}

module.exports = {
    verifyConditions,
    verifyRelease,
    prepare,
    publish,
    publishToTest,
    writeReleaseMetadata,
};
