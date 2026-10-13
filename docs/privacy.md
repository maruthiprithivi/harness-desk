# Privacy and recovery

[README](../README.md) · [Runtime controls](runtime.md) · [Security reports](../SECURITY.md)

## Local data

Inventories, chats, imported audits, journal excerpts, measurements, reports and backups stay in the selected data directory. Source launchers use `data/`; the packaged CLI defaults to `~/.harness-desk`.

On Windows, Unix file-mode bits do not establish private access. Use a user-owned directory with restricted Windows permissions; native ACL acceptance remains outstanding.

Discovery avoids credential files and keeps supported configuration metadata-only. Opening an eligible file explicitly reads its body. Recognized secrets and SOPS documents are withheld from editing and backup. Sign-in probes use agent CLIs rather than reading auth files.

## Outbound requests

User-initiated agent requests send reviewed context through the selected provider. Inspect the preview first. Pattern redaction cannot prove arbitrary prose is safe.

Verification can consume tokens and start configured hooks, MCP connections, extensions or permitted tools. Read-only shell settings do not prevent every startup side effect; capability labels describe these limits.

## Backup and recovery

Configuration saves create private backups and require diff review. Loading a backup prepares a draft for explicit saving. Workflow adoption has a pinned ownership record and its own recovery action.

Changed, linked or uncertain files are preserved. Inspect incomplete recovery rather than overwriting newer content.

## Retention

Preview records older than 24 hours, seven days or thirty days. Retention archives eligible manifest-listed HTML, Markdown and JSON. Running/pinned chats, settings, the gap ledger and configuration backups are protected. Source configuration is outside cleanup.

Archiving preserves bytes; it does not reclaim disk space. Stop the app and review data before permanent removal with normal filesystem tools.

## Public contributions

Share reusable code, generic docs and synthetic examples only. Keep real inventories, sessions, journals, account configuration and screenshots private. Repository and package gates supplement human review; they are not a secrecy guarantee. See [CONTRIBUTING.md](../CONTRIBUTING.md).
