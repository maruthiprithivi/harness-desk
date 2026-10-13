# Release checklist

[README](../README.md) · [Contributing](../CONTRIBUTING.md)

## First npm release

Public GitHub source exists. A package additionally needs:

- A maintainer-selected license and matching metadata.
- An installable CLI with data outside its installation.
- A reviewed file allowlist and tested archive.
- Private vulnerability reporting.
- A clean commit and passing publishing gates.
- Platform evidence and accurate support labels.

The candidate is `0.1.0-beta.1`. Windows stays experimental until its acceptance work is complete. Packaging does not establish unsupported agent capabilities.

GitHub prereleases can distribute the same reviewed archive before npm registry publication. Mark previews as prereleases and upload only the tested runtime archive and its checksum.

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

Review license, version, changelog, archive and registry identity. Recheck package-name availability. Publish the reviewed prerelease under `beta`; reserve `latest` for an accepted stable release.

Install the exact registry version in a fresh isolated environment and repeat the smoke test. Verify docs and downloads; record the version and source commit in release notes.

## Recovery

Preserve user data. Deprecate a bad registry version with a concise reason and publish a corrected version rather than rewriting it. Users can reinstall a known good version with their existing data directory. Verify data compatibility before recommending a downgrade.

Windows backlog: [lifecycle](https://github.com/maruthiprithivi/harness-desk/issues/6), [configuration/recovery](https://github.com/maruthiprithivi/harness-desk/issues/7), [agent adapters](https://github.com/maruthiprithivi/harness-desk/issues/8).
