# Contributing to Harness Desk

Harness Desk helps people understand and improve their local coding-agent setup. Contributions should make that experience easier to understand and preserve the distinction between discovered configuration, predicted loading and observed behavior.

## Get started

Use Node.js 22 or newer and Git (Git for Windows on Windows).

```sh
git clone https://github.com/maruthiprithivi/harness-desk.git
cd harness-desk
npm run hooks:install
npm start
```

Open the loopback address printed by the launcher. There are no runtime packages to install. See [README.md](README.md) for background-server behavior and stopping the process. For development, `node server.mjs` runs in the foreground.

The hook installer is explicit: cloning or starting the app does not install hooks. It adds repository-local wrappers that run your existing effective hooks first. The existing hook files are preserved, including security guards and non-publishing hooks. Standard input is replayed for push checks. Re-running installation is safe when the managed files and configuration have not changed. `npm run hooks:uninstall` restores the previous local setting, or returns to inherited global configuration. Inspect unexpected hook changes instead of overwriting them.

## Local checks

```sh
npm test
npm run check:local
npm run check:release
```

`npm test` discovers every `test/*.test.mjs` file. Tests must use synthetic repositories, homes and sessions, and must not require a signed-in agent or make provider requests.

`check:local` checks private-directory exclusions, public source, JavaScript syntax and the complete test suite. Pre-commit checks source and staged content. Pre-push checks the exact outgoing history and runs the local gate. A failure blocks that operation. Do not bypass these checks with `--no-verify`, alternate hooks or force-adding ignored files.

`check:release` is a separate package-release gate. It requires an approved project license, package metadata, CLI entry point, explicit package file selection and a clean reviewed commit, then runs local and history checks. It is also the `prepack` guard. Until these prerequisites exist, a blocked release is expected. Passing automation does not replace reviewing the actual archive or running platform acceptance checks. GitHub source publication and an npm package release are separate operations.

On machines where development must run in Docker, run checks in an offline Node 22 container with a source-only mirror. Never mount private agent homes into a test container or send private fixtures to remote CI. Live harness checks are separate, explicitly initiated activities that may use tokens and run configured hooks or tools.

## Private data and cleanup

Publish reusable source, generic documentation and synthetic fixtures only. Keep local inventories, prompts, conversations, transcripts, journals, configuration, screenshots, credentials and generated reports private. Never paste them into public issues, pull requests, CI logs or artifacts. Redaction patterns cannot establish that arbitrary text is safe to publish.

```sh
npm run clean:local
npm run clean:local -- --apply
```

The first command previews cleanup. The second moves only `.verification/` and `data/qa/` into a Git-ignored `.local-archive/` recovery folder. Stop fixture processes before archiving their workspaces. Each archive has a manifest recording original paths and move status, including partial completion. Nothing is deleted; archiving does not reclaim disk space. To restore, stop affected development processes and move entries back only when the original destination is absent. Keep the archive private.

Cleanup never selects app settings, conversations, configuration backups, journal sources, the local agent ledger or agent homes. It refuses tracked content, missing ignore rules and symlinked candidate directories. Do not use blanket `git clean -fdx` or recursive deletion to prepare a release.

Before authorized publication, review every staged file and the complete outgoing history. Run all three checks against the actual checkout:

```sh
npm run check:public:source
npm run check:public
npm run check:public:history
```

Use explicit file staging and a public GitHub noreply commit email. A zero-object staged/history check does not validate unpublished source. New public file locations must be deliberately added to the allowlist in `scripts/check-public.mjs` and covered by a test; do not weaken exclusions to make a check pass.

## Propose and implement a change

Check existing issues before opening one. Explain the user problem, expected behavior, supported platforms and a minimal synthetic reproduction. For larger changes, agree on scope in an issue before implementing them. Keep fixes focused and preserve unrelated work.

Include meaningful regression tests for behavior changes. For an agent adapter, test fresh-session identity, scope, token accounting, malformed or unsupported formats, cancellation and permission behavior. Do not report availability as loading, successful execution as task correctness, cached input as zero cost, or missing evidence as zero usage. Update the [capability matrix](docs/context-measurement-capabilities.md) and UI support labels when capabilities change.

UI changes should use plain language, keyboard-accessible controls and clear next actions. Verify affected flows in a browser at desktop and narrow widths. Use synthetic screenshots for public review.

## Submit a pull request

Describe the problem, resulting behavior and validation. State what remains untested, especially native Windows behavior and real provider calls. Include a rollback approach for configuration-writing changes. Keep private testing evidence local. All bundled third-party code must retain license notices and reproducible provenance.

The project uses the [MIT license](LICENSE). Contributions are provided under the same license. Bundled third-party code retains its own notices.

## Bugs and security concerns

Report ordinary bugs with versions, platform, sanitized steps and expected versus actual behavior. Do not attach your full configuration or transcript.

For a suspected vulnerability, follow [SECURITY.md](SECURITY.md) and use the repository's private vulnerability reporting channel. Do not post exploit details or sensitive data publicly.
