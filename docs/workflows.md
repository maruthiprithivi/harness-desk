# Reuse work without expanding startup context

[README](../README.md) · [User guide](user-guide.md) · [Privacy and recovery](privacy.md)

## Find a repeat

In **Reusable work**, explicitly choose Claude or Codex session files for local analysis. Normalized prompts, commands and three-to-eight-step tool sequences qualify at three occurrences across two sessions. These are heuristics; co-occurrence does not prove dependencies.

Select a candidate or describe a workflow. Add notes, choose global/project placement and a Claude/Codex skill format, then choose the answering agent independently. Review the bounded request before generating. Raw examples and unrelated repositories are excluded; missing inputs can produce follow-up questions.

## Keep the entry small

Drafts contain a concise skill entry, a deferred Markdown procedure, up to four portable Node scripts, and trigger/non-trigger checks. Explicit invocation is the default. Automatic matching still has a resident description cost.

Claude `@path` imports in `CLAUDE.md` are eager. Use an instruction to read a procedure when invoked for the intended lazy pattern.

## Review and adopt

Review-before-save is the default; automatic draft saving is optional. Saving does not install or execute scripts. Validation bounds files and rejects unsafe paths or sensitive output; it does not prove code safety or correctness.

Download the ZIP for manual review or use guided adoption. Adoption previews exact destinations, requires acknowledgement and refuses existing files. Default roots are `.claude/` and `.agents/` at the chosen scope; alternate homes require manual placement.

Keep `skills/`, `workflows/` and `scripts/` as siblings. Procedure links use `../scripts/<name>/<file>.mjs`; moving everything under one skill folder breaks references.

## Verify and recover

Collect before readings before adoption. Restart the harness, check discovery, test the trigger and non-trigger, then repeat a representative task. Assess response quality alongside tokens and elapsed time.

**Restore added files** archives only owned, unchanged files. Changed or uncertain content stays for inspection. Recovery withdraws the skill entry before dependencies and reports partial failures. Hard-link support is required; cross-volume recovery may need manual handling.

Saved or installed status is not evidence of execution or savings. The app does not calculate electricity or water savings from token counts.
