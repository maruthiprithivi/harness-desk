# Public repository policy

The upstream is https://github.com/maruthiprithivi/harness-desk. It is public.

Publish reusable source, generic documentation and synthetic tests only. Keep local inventories, conversations, transcripts, imported audits, journals, screenshots, agent configuration, credentials, secret bundles and machine-specific paths private. The local .break-free ledger must stay ignored in this project.

Never paste private evidence into public issues, pull requests, CI logs or artifacts. Do not send private sources to external models or remote CI for verification without explicit authorization.

Before an authorized publication, review the complete outgoing history and public diff. Run npm run check:public:source, npm run check:public and npm run check:public:history. Never force-add ignored files, bypass publishing hooks or use git add . without reviewing every candidate. Pattern checks supplement human review and cannot prove arbitrary prose contains no private information.

Use a public GitHub noreply email for commits. Installing the repository hooks must preserve any existing user hooks. Merely selecting this upstream does not request a code push.
