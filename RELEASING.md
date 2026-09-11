# Releases

GitLab releases automatically from `main` after lint, typecheck, build, release
tests and Homey validation pass. Merge requests, other branches and tag pipelines
do not publish. The release job is serialized across pipelines.

Use Conventional Commits for commits merged into `main` (including squash commit
titles):

| Commit | Version bump |
| --- | --- |
| `fix: reconnect gateway` | Patch |
| `perf: reduce polling overhead` | Patch |
| `feat: add battery support` | Minor |
| A commit with a `BREAKING CHANGE:` footer | Major |
| `docs:`, `chore:`, `ci:`, `test:`, `refactor:` | No release by themselves |

semantic-release uses the existing `v*` tags, starting after `v1.0.2`, to select
the next version. Keep these tags in the repository. Do not manually bump versions
or supply the old `BUMP` and `CHANGELOG` pipeline variables.

The release updates `CHANGELOG.md`, `.homeychangelog.json`, both Homey manifests,
and the npm package/lock versions. It validates the generated app, commits those
files with `[skip ci]`, tags the commit, uploads to Homey, waits for processing,
and publishes that exact build to **Test**. Finally it creates a GitLab release
with the generated notes and Homey Test link. Nothing is published to npm.

Homey Test uses ordinary versions such as `1.0.3`; it is a store channel, not a
SemVer prerelease suffix. The CLI alone only uploads a draft, so the release hook
also calls `AthomAppsAPI.updateBuildChannel` with `channel: "test"`, as used by
the Homey developer portal. It never submits for certification or promotes to
Live. An app that has never been certified still needs Homey's initial approval
before other users can install it.

## One-time GitLab setup

Set these CI/CD variables as **masked and protected**:

- `HOMEY_PAT`: the app owner's personal access token from
  <https://tools.developer.homey.app/me>.
- `RELEASE_TOKEN`: a project access token with `api` and `write_repository`
  scopes and a role permitted to push to protected `main` and create `v*` tags.
  The job maps this to `GL_TOKEN` and uses `CI_SERVER_URL` for this GitLab instance.

Protect `main` so the variables are available there. Allow the release token's
bot to push release commits under the branch/tag protection rules. The runner
needs outbound access to GitLab, npm and Homey's APIs. CI uses Node 24; local
release tooling requires Node 24.15 or newer.

## Validation and recovery

Run `npm ci --ignore-scripts`, `npm run test:release`, `npm run lint`,
`npm run typecheck`, `npm run build`, and
`npm exec -- homey app validate --level verified` locally. The release tests use
fake API responses and never upload an app.

On a release branch with credentials configured, `npm run release -- --dry-run`
previews the next version and notes. semantic-release still checks credentials
and Git push access in dry-run mode, but skips commits, tags and publishing.

semantic-release pushes its commit and tag **before** publishing. If upload or
Homey processing fails, rerunning semantic-release will not republish that tag.
Inspect the failed build in the Homey developer portal, then use a separate clean
checkout of the failed release tag, install dependencies, and run
`HOMEY_PAT=... npm run release:homey:retry` with your token supplied securely via
the environment. The retry requires HEAD to match the manifest's tag. It reuses
an existing build of that version, waits for processing and promotes a draft to
Test, or uploads if no build exists. It fails on processing errors, unexpected
states or ambiguous builds. Never delete a released tag to force a retry.

The recovery command only completes Homey publishing. If the failure prevented
the GitLab release entry from being created, create it for the existing tag using
the corresponding `CHANGELOG.md` notes after confirming Homey Test succeeded.

References: [semantic-release](https://semantic-release.gitbook.io/semantic-release/),
[Homey publishing](https://apps.developer.homey.app/app-store/publishing).
