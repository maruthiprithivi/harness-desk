# Context measurement capabilities

Verified on 2026-10-13 against Claude Code **2.1.296** and Codex CLI **0.162.1**. This is the measurement boundary for Harness Desk's first-use flow.

## What was verified

Local version/help, generated Codex schemas, official documentation and pinned source were inspected. Persisted Claude parent logs parsed successfully in two local samples; sidechains were excluded. A real fresh Codex 0.162.1 session subsequently verified first-request extraction. The managed runner then launched two fresh sessions, located each exact session automatically, captured input usage and passed the configured literal response check in both. A shortened synthetic instruction produced an observed input difference; this is no general savings or causality claim. Private runtime artifacts remain outside published source.

Codex paginated logs distinguish actual user input with `metadata.user_input_order`. Injected instructions can also use the user role. The adapter follows this provenance and rejects inherited user messages instead of treating the first user-role message as the prompt. See the [pinned history schema](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/history/src/lib.rs).

| Question | Claude Code | Codex |
| --- | --- | --- |
| Can we observe aggregate request input? | Statusline exposes request input and cache counts after an API response. Supported session response usage was validated against local parent logs. | App-server emits `thread/tokenUsage/updated`; rollout token records expose response usage. |
| Can we measure context before the first prompt? | Not established through statusline; values can be null until the first API response. | Not established through response counters. |
| Can we break context into system prompt, tools, skills and instructions? | `/context [all]` provides a user-facing breakdown. No stable machine-readable export was verified. | No `/context` command in 0.162.1 and no semantic category breakdown in the generated usage schema. |
| Can we confirm instruction file loading? | `InstructionsLoaded` reports file, scope and reason, with an important AGENTS.md exception below. | Relevant session/log evidence can establish injection. Scanning current files alone predicts loading. |
| Can we discover tools and skills? | Native commands expose configuration and availability. | `skills/list` and `mcpServerStatus/list` expose availability; this is separate from prompt inclusion or use. |
| Can we automate a verification task? | Programmatic execution exists, but ordinary startup can run hooks and connect MCP servers. | App-server/exec can run a bounded task. Permissions and launch settings affect fidelity. |

## Claude Code

The [statusline contract](https://code.claude.com/docs/en/statusline#context-window-fields) supplies `context_window.current_usage`, `context_window_size`, `used_percentage` and `remaining_percentage`. Current input is:

```text
input_tokens + cache_creation_input_tokens + cache_read_input_tokens
```

Output is excluded from that input percentage. `current_usage` can be null before the first response and after compaction; missing data is not zero. Current documentation describes `total_input_tokens` as current-window input, so do not assume that name means lifetime consumption. Bind parsing to supported versions and explicit fields.

The [command reference](https://code.claude.com/docs/en/commands) documents `/context [all]`, including expanded per-item details. Treat an imported report as a **harness-reported breakdown**, not independently measured category tokens. Neither a supported JSON export nor provider-exact category attribution was established. Do not assume `claude -p /context` is equivalent to the interactive command.

The [InstructionsLoaded hook](https://code.claude.com/docs/en/hooks#instructionsloaded) observes eager and later instruction loads. It provides `file_path`, `memory_type`, `load_reason`, and optional import/trigger paths. Reasons include session start, includes, nested traversal, path matches and compaction. **It does not fire for AGENTS.md read directly through Project instructions settings.** It does fire for an AGENTS.md imported or symlinked from CLAUDE.md. Absence of a hook event therefore cannot prove absence from context.

[Memory documentation](https://code.claude.com/docs/en/memory) also explains that CLAUDE.md `@` imports load with their parent; moving text into an imported file does not make it lazy. Loading depends on version and settings, not just filename existence.

## Codex

The installed binary's generated schema confirms **`thread/tokenUsage/updated`**, not `turn/tokenUsage/updated`. Its payload contains `threadId`, `turnId`, and `tokenUsage` with `last`, `total`, and nullable `modelContextWindow`. Usage fields cover input, cached input, cache writes, output, reasoning output and total tokens, not semantic prompt categories.

The [pinned protocol source](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/protocol/src/protocol.rs) distinguishes cumulative `total_token_usage` from `last_token_usage`. `token_count.info` may be null. Overflow handling can synthesize a total-token value: a token event is not automatically a fresh provider measurement. Do not chart cumulative consumption as context occupancy or add cached tokens again to Codex input.

The [pinned command list](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/tui/src/slash_command.rs) has `/status`, `/statusline` and `/debug-config`, but no `/context`. The [app-server documentation](https://developers.openai.com/codex/app-server/) describes scoped skills, MCP status and token notifications. Availability, authentication, loading and invocation remain different facts.

[Instruction verification guidance](https://developers.openai.com/codex/guides/agents-md) points to logs/session evidence. A model's own explanation is behavioral evidence, not a definitive load audit.

Reproduce the interface inspection without starting a model request:

```sh
claude --version
claude --help
codex --version
codex app-server --help
codex app-server generate-json-schema --out ./codex-schema --experimental
```

Keep generated inspection artifacts outside published source.

## First implementation and acceptance boundary

1. The managed Codex runner locates the exact fresh session returned by the CLI automatically. Manual import remains an alternative. Retain allowlisted measurements and provenance; do not persist transcript bodies in measurement records.
2. Label the metric **first recorded request input**. It includes the initial prompt and startup additions; it is not pure pre-prompt context. Reject incomplete, forked, compacted or ambiguous origins instead of inventing a baseline.
3. Show measured aggregate input against capacity only when capacity is known. Keep file-size estimates separate from observed totals; never use estimates to fill measured category segments.
4. Compare distinct fresh sessions with the same agent version, model, project, launch directory, initial prompt and collection method. Record launch flags, permissions, effort and relevant environment differences. Without control of these factors, report an observed difference rather than a causal saving.
5. Run a representative task with explicit outcome checks. Record passed, failed or inconclusive separately from token differences. A model saying it followed instructions is insufficient verification.

[Claude headless execution](https://code.claude.com/docs/en/headless) loads normal project hooks and MCP servers without interactive trust prompts. Bare/safe modes remove parts of the setup and invalidate normal-session comparisons. A fresh verification session may spend tokens or trigger configured startup actions: **do not describe it as a side-effect-free dry run**.

The UI distinguishes **observed**, **predicted**, and **unavailable**. The ten-minute product promise is complete only when a real, comparable measurement and representative behavior check both succeed.


## Managed verification

Start here offers Run baseline check and Run again after a change. Each explicit action starts one fresh supported agent session, captures its own first-request input and saves the result. Repeat runs reuse the task, expected literal text, resolved model and launch folder. Comparisons require matching managed launch profiles in addition to the recorded version and prompt identity. They are not interchangeable with manual readings from unrestricted sessions.

The Codex profile retains normal global/project configuration while requesting a read-only shell sandbox and denying approvals. The prompt prohibits tools and edits; observed tool/command activity fails the bounded response check. This is not a guarantee against startup hook or remote MCP side effects. The UI discloses account token use and startup behavior before each run.

Model runs have a three-minute limit, plus up to fifteen seconds each for version inspection and an exact-session export where needed. Output is bounded, cancellation stops the process tree, and no automatic retry is sent. Restarted runs are marked interrupted. Expected-text checks validate a literal substring in the final response only. They do not certify general task correctness, lazy loading or individual file inclusion. Model, capacity and launch differences can make comparisons unavailable. The real Codex logs tested did not report capacity, so the UI displays input counts without a percentage.

## Agent support levels

| Agent | Automatic capture | Validation | Limits |
| --- | --- | --- | --- |
| Codex | First-request input and response check | Real macOS session, 0.162.1 | No verified category breakdown; capacity only when reported |
| Claude Code | First-response input including cache reads/writes, response check | Synthetic stream/runner/API tests; fresh live check blocked by account quota on 2.1.296 | No successful live managed measurement yet; existing allowed tools and startup hooks can run |
| OpenCode | First completed step from an automatic export of the exact emitted session | Real macOS session, 1.18.35 | 1.x export only; sharing disabled in a merged environment overlay; no sandbox |
| Oh My Pi (OMP) | Completed first-response input from a fresh ephemeral JSON session | Real macOS session, 18.6.0 | Retries, resumed sessions and extra requests rejected; no sandbox |
| Kimi Code | First-request usage from the exact session’s native wire journal | Real macOS session, 2.1.1 / wire 1.5 | Native 2.x only; headless permissions apply; no sandbox |
| Kiro | Harness-reported context percentage after the response, plus response check | Real macOS session, 2.24.1 / ACP v1, engine v2 | No first-request token total, observed model or capacity; startup savings comparison unavailable |
| Pi | Completed first-response input from a fresh ephemeral JSON session | Synthetic parser and runner tests | Not installed for live validation; extensions and tools are not sandboxed |
| Orca | None | Discovery only | Manual request handoff |

Configuration discovery includes default OpenCode, OMP and Pi homes and project folders. Only Claude/Codex have loading predictions. The others expose discovered files without asserting precedence or actual context inclusion. Custom profile directories and alternate configuration homes are not fully covered. Installation and sign-in are independent of adapter support. Existing manual session import and usage mining still support their documented formats; automatic verification does not extend every analysis feature to every agent.

Claude uses a UUID-pinned print session, denies permission prompts and limits the run to one turn. Its response usage is counted once per message ID; final cumulative result usage is ignored. OpenCode captures the fresh session ID from JSON events and invokes export for that exact ID. OMP/Pi use no-session JSON output and require one matching user request and completed assistant response. Kimi uses the ID returned by its print process, exports with the global diagnostic log excluded, reads only the manifest and main wire journal from a bounded ZIP in memory, then removes the private temporary archive in a finally block. An interrupted machine can leave a temporary archive for OS cleanup. No adapter searches arbitrary old sessions for a convenient reading.

Kiro percentages are not interchangeable with first-request input. The UI labels the point in the run and does not compute a token saving or directly comparable percentage reduction without observed model and capacity. Credit charges are never treated as token counts.

Windows launch and cancellation have synthetic coverage only. No real Windows machine or every provider/model combination has been verified.

### Extended adapter sources

- [Pi JSON mode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md) and [session format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md)
- [Oh My Pi CLI reference](https://github.com/can1357/oh-my-pi/blob/main/docs/cli-reference.md)
- [OpenCode 1.18.35 run](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/cli/cmd/run.ts) and [export](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/cli/cmd/export.ts)
- [Kiro headless documentation](https://kiro.dev/docs/cli/headless/); installed v2 output was verified independently of newer v3 authentication requirements
- [Kimi print rendering](https://github.com/MoonshotAI/kimi-code/blob/main/apps/kimi-code/src/cli/prompt-render.ts) and [native print execution](https://github.com/MoonshotAI/kimi-code/blob/main/apps/kimi-code/src/cli/v2/run-v2-print.ts)

