# Release checklist

[README](../README.md) · [Contributing](../CONTRIBUTING.md)

## GitHub distribution

Users can clone the repository or install a versioned archive from GitHub Releases. npm registry publication is deferred and is not a release requirement.

Each release needs:

- The MIT license and matching metadata.
- An installable CLI with data outside its installation.
- A reviewed file allowlist and tested archive.
- Private vulnerability reporting.
- A clean commit and passing publishing gates.
- Platform evidence and accurate support labels.

The current preview is `0.1.0-beta.1`. Windows stays experimental until its acceptance work is complete. Packaging does not establish unsupported agent capabilities.

Mark previews as GitHub prereleases and upload only the tested runtime archive and its checksum.

## Validate

```sh
npm run check:local
npm run check:public:source
npm run check:public
npm run check:public:history
npm run check:release
```

Build from a clean reviewed checkout. Never bypass `prepack` with `--ignore-scripts`. Inspect the actual archive, install it in an isolated profile and check help, version, startup, readiness, repeated start and shutdown. Confirm no local generated data is packaged.

CI uses public source and synthetic fixtures only. Platform smoke tests differ from live provider validation; keep private acceptance evidence local.

`npm run smoke:package -- --archive-dir .verification/release` retains a successfully tested archive without overwriting an existing file. Only publish that archive after inspecting it and verifying platform CI.

## Publish

Review the version, changelog, archive contents and complete outgoing history. Tag the reviewed source commit and create a GitHub release with the tested archive and `SHA256SUMS`. Record the source commit, installation command, validation and support limits in the release notes.

Download the published archive, verify its checksum and install it in a fresh isolated environment. Repeat the lifecycle smoke test and check documentation links. Keep preview releases marked as prereleases until stable acceptance is complete.

## Recovery

Preserve user data. Add a warning to a faulty release and publish a corrected version; do not replace published archives or move their tags. Users can reinstall a known good GitHub archive with their existing data directory. Verify data compatibility before recommending a downgrade.

Windows backlog: [lifecycle](https://github.com/maruthiprithivi/harness-desk/issues/6), [configuration/recovery](https://github.com/maruthiprithivi/harness-desk/issues/7), [agent adapters](https://github.com/maruthiprithivi/harness-desk/issues/8).
