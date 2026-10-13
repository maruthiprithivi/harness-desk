# Harness Desk product brief

Date: 2026-10-13
Status: Interview synthesis for review. Requirements describe the intended product, not a claim that every capability exists today.
Related work: UX and configuration-loading issue #3; verification issue #5; capability-gap issue #2.

## Product promise

Know what your agents are using, fix what needs attention, and verify that your setup gets better over time.

Harness Desk is a local browser utility for macOS and Windows. It helps people understand and maintain the instructions, settings, skills, tools and MCPs used by their coding agents across projects. It explains the setup, points to worthwhile changes and checks their results.

## Who we serve first

The primary user already has multiple coding agents and projects. Their setup has accumulated over time, and they no longer know which instructions apply, which tools are available, or what is consuming context. They usually arrive with an existing project or session.

Use explanations a beginner can understand by default. Do not require knowledge of configuration paths, precedence rules or agent terminology before the user can act. New-project setup is a supported secondary entry point; it explains inherited global guidance before adding project-specific choices.

The immediate problem is uncertainty and effort: users can see files but cannot easily connect them to session behavior, decide what deserves attention, or tell whether a change helped. More inventory alone does not solve that problem.

## First-use success

Within ten minutes, a user should be able to select a project and agent, understand what loads and where it comes from, identify one worthwhile fix, apply it, and see a verified before-and-after improvement in startup context usage.

This is an acceptance target to test, not an established completion time. A complete demonstration requires a real supported agent, comparable fresh sessions, and a representative task. Synthetic fixtures can validate UI behavior but cannot prove real context savings.

Success is conditional on evidence: if a proposed change saves no context or harms the task, report that result and offer recovery. Do not manufacture an improvement to finish the journey.

## Core journey

| Step | User's question | What Harness Desk provides |
| --- | --- | --- |
| Orient | Which project, agent and session am I looking at? | One persistent scope selector beside the content, a session or launch-folder identifier, and observation time. |
| Understand | What loads, and where does it come from? | Startup context composition and a source hierarchy, with global, repository and applicable folder origins. |
| Notice | What is good, problematic or worth improving? | A short prioritized list of specific insights, each with a reason and evidence. |
| Investigate | Why does this matter for my work? | Related instructions grouped by meaning, exact source locations, expected impact and a focused conversation. |
| Change | How do I fix it? | Manual syntax editing or a proposal from a chosen agent, followed by explanation, diff and approval. |
| Verify | Did the change help without breaking needed behavior? | A fresh-session comparison and a small representative task, with pass, fail or inconclusive findings. |
| Maintain | What changed since last time? | New changes, recurring problems, reusable-work opportunities and the results of earlier fixes. |

The overview begins this journey. The canvas and explorer support investigations within it; users should not need to learn the entire file tree before getting value.

## Show the setup accurately

Cover instructions and memory, agent settings, skills, custom agents or delegation, built-in tools, and MCP servers and tools. Keep these distinctions visible when they matter:

- Found on disk.
- Configured or enabled for this scope.
- Available to this agent.
- Predicted to load, including the reason.
- Observed in a particular session's context.
- Observed being invoked or used.

These are different facts, not one progression every component necessarily follows. Installed does not mean loaded. Loaded does not mean used. No observed use does not mean unused.

For each instruction, identify its source file and global, repository or folder scope. Show additions, applicable overrides, conflicts and exclusions using rules validated for that agent and version. Keep configuration precedence separate from instruction guidance. A visually reordered node must not imply a change to runtime precedence.

A new project outside existing repositories and a new folder inside a repository can inherit different guidance. Explain the selected launch location rather than assuming every new folder is empty of inherited configuration.

For MCPs, distinguish configuration files, named servers and individual tools; never present file counts as tool counts. Where supported, expose enablement, configuration checks, authentication or connection state, and recorded usage with its time window. Unknown state stays unknown. Support filtering and sorting so large inventories lead to manageable decisions. Editing, deactivation and removal require clear scope and impact; hiding something on the canvas changes only the view.

## Context composition is the primary evidence display

Show the whole context window and the occupied share at the start of a session, before ordinary work grows the conversation. Categories may include system instructions, built-in tool schemas, MCP tool schemas, skill metadata, custom agent definitions, instructions and memory, conversation content, free capacity and compaction reserve, according to what the agent actually reports.

Use the actual reported capacity and measurement point. Do not assume a fixed million-token window. Avoid double-counting categories or inventing a split when a report combines them. Attribute global and project contributions only when the evidence supports that attribution.

The main visual result is a paired before-and-after bar using a shared scale and category colors, accompanied by total occupied tokens, percentage points changed and the sources responsible where known. Label measurements, estimates and unknowns distinctly. If capacities or collection conditions differ, explain why a direct savings comparison is not available.

Missing measurement must have a useful next action, such as starting a supported verification session. Do not fill the screen with empty bars and repeated “Not measured” labels. Available inventory estimates remain useful but appear separately from observed context. Manual report import is a fallback, not the normal first-use burden.

## Terse insights and meaningful groups

Lead each insight with a short judgment and its reason: “Looks good,” “Needs attention,” “Could be lighter,” or “Needs checking.” A judgment must have evidence and a specific next action. Avoid opaque aggregate health scores.

Group instruction content by meaning, even when the content spans several files: framework choices, tools and commands, working approach, testing and review, security and approval boundaries, and task-specific procedures. Retain the original source and location for every excerpt. Semantic grouping initially changes presentation; rewriting or moving files is a separate proposed action.

For browsing large component inventories, group by pack, provider or source family, then progressively expand to individual components. Semantic instruction groups and source-family groups solve different problems and should not be confused. Avoid hundreds of leaves at once or hidden scrolling inside small canvas nodes.

Rank on two independent fronts:

1. **What to improve first:** prioritize conflicts, missing required guidance, repeated failures and meaningful avoidable context cost. Explain urgency, confidence and affected scope.
2. **When information should load:** recommend startup guidance, path/task-conditional guidance, on-demand procedures, or retirement review. Importance does not automatically imply eager loading.

Keep user dismissals and their reasons. Reopen an insight when relevant evidence changes, rather than repeatedly presenting the same recommendation.

## Help users configure for their actual work

“Help me configure this project” begins a short guided conversation. Start from the existing setup and available project context; ask about objectives, technologies and working preferences only where needed. Show the resulting understanding for correction. New projects can begin from the user's description.

Recommendations must be project-specific. Explain whether a change belongs globally, in the repository, in a narrower path, in a skill, in a reusable script, or in an enforceable check. Global changes should explain their possible effect on other projects. Model or harness evolution can trigger a review of old guidance, but age alone is not proof that an instruction is obsolete.

Users choose an available signed-in coding agent from a simple selector. Authentication certainty must reflect what can actually be checked. Start a multi-turn conversation from an insight, file, group or selected set of components. Preserve that scope, allow custom notes, and let the answering agent ask focused follow-up questions with helpful guidance. Choosing an answering agent must not silently change which agent's setup is under review.

## Changes, approval and recovery

The default is a plain-language explanation plus a file diff for approval. Explain what changes, why, its scope, and how it will be checked. Manual editing remains a first-class route, with syntax highlighting for Markdown, JSON and configuration/code formats, and a resizable editor close to the selected source.

Offer an explicit automatic-apply option with backup and Undo. Make its scope and duration visible; do not infer permission for every project from a single automatic action. Automatic application still records the change and runs the agreed verification. It must report failures or uncertainty rather than silently claim success.

Before writing, check that the source still matches the reviewed version. Create a recoverable backup and record exactly what changed. Undo must detect intervening edits and offer a conflict-aware restore instead of overwriting newer work. Configuration retirement defaults to recoverable removal or archiving. Generated-artifact pruning is a separate operation.

Opening a file makes no changes. Generated installation records need a clear purpose explanation and guidance toward the appropriate installer when applicable. Do not present every JSON file as a user-authored instruction.

## Verification completes the change

Capture a baseline from an existing suitable session where possible, or offer a fresh baseline run. An existing conversation may already have grown or compacted; do not label its current size as startup context without evidence.

After a change, provide two routes:

- **Use my next session:** collect supported evidence as the user starts a fresh session and works normally.
- **Verify for me:** start a bounded fresh session and run a small representative task, with the expected activity and potential token cost explained simply.

A static preview can predict a configuration. Observed verification must actually exercise the agent. Avoid calling a token-consuming run a cost-free dry run.

For a procedure moved to on-demand loading, the representative test should check that its full instructions are absent at startup where observable, are found when needed, and guide correct behavior. Check relevant tools and required boundaries too. Choose a bounded task that avoids unintended changes to the user's working project; show its scope before execution.

Keep agent, model, project, launch directory, relevant versions, permissions, configuration fingerprints, task and collection method comparable. Identify cold/warm or cache conditions when they affect reported counters. Separate startup context occupancy from billed input, cached tokens, task tokens and cost. An agent saying “I loaded it” is insufficient evidence on its own.

The result shows baseline and current measurements, what changed, task outcome, evidence coverage, and one next step: keep, investigate or undo. State pass, fail or inconclusive for each check. A smaller startup with a failed task is not a successful optimization. One representative task establishes bounded evidence, not universal correctness.

## Ongoing value

On return, lead with what changed and what needs attention in the selected project and agent. Detect context growth, conflicting or stale guidance, potentially unused skills/MCPs, recurring mistakes and repeated work. Let users control collection scope and cadence; this brief does not create a background schedule.

Repeated work should produce candidates for concise skills, deterministic reusable scripts or linked workflows. Prefer reusing an existing component. Keep skill descriptions short and procedures/scripts on demand through supported discovery mechanisms. A pointer to Markdown alone does not prove that the agent will find or follow it. Offer creation with optional user notes and the same approval/automatic-apply choice. Verify the generated component with a representative trigger and a case where it should stay inactive.

Recurring mistakes should lead to the most effective suitable fix: an enforceable hook or check where supported, a test, scoped guidance, or a procedure. Track recurrence before and after rather than continually rewording an ineffective instruction. Optional journal lessons can inform proposals, with user-authored intent outranking inferred preferences; proposed journal updates remain reviewable.

Agent/model delegation is a related optimization area: help route suitable tasks to less expensive capable models and verify quality. Do not equate lower token counts with lower total cost, or claim measured electricity/water savings without supporting measurements.

Log Harness Desk's own unsupported cases, parsing gaps and failed actions. Explain the impact and offer an explicit user-triggered agent conversation to investigate an improvement. The utility must make its own coverage limits visible.

## UX and visual direction

Use Impeccable's Operate mode: task completion, legibility and familiar controls govern the design. Preserve the existing restrained slate/teal identity unless a later visual exploration deliberately replaces it. This brief sets interaction direction, not a pixel-level redesign.

- Keep project, agent, session and launch scope close to the evidence they affect; avoid duplicate selectors scattered across pages.
- Give the overview one clear focal area: startup composition and the next worthwhile improvement. Put the full inventory behind drill-down.
- Prefer rows, grouped lists and dividers to nested cards. Use panels for distinct tasks, not as decoration around every label.
- Use readable typography: body text around 16px, supporting text at least 14px, and a consistent sans-serif family. Reserve monospace for paths and code.
- Expand a graph progressively: category, source family, individual component. Keep full names accessible and provide visible Edit actions.
- Keep explorer, selection and resizable editor synchronized. Support keyboard equivalents for hover, right-click and lasso actions. Label view-only hiding distinctly from deactivation.
- Keep the conversation, proposal and diff attached to the chosen issue so users retain their place. Avoid stacked modals and unnecessary navigation.
- Use color consistently for category and state, with text labels so color is never the only signal. A smaller bar must still show actual values and comparable conditions.
- Use plain, specific copy. Remove repeated caveat paragraphs, vague success claims, decorative metrics, generic AI slogans and ornamental motion. Place uncertainty beside the decision it affects.
- Design empty, scanning, partial-coverage, disconnected-agent, changed-source, failed-save, failed-verification and undo-conflict states. Each needs an explanation and recovery action.
- Test long paths, zero and hundreds of components, narrow windows, keyboard use, zoom and preserved unsaved edits. Do not squeeze a desktop three-pane workspace into unreadable columns.

### Mobbin references inspected

These references inform interaction patterns, not copied visual assets or evidence that the proposed design is validated.

| Reference | Observed pattern | Application to Harness Desk |
| --- | --- | --- |
| [Linear grouped issue view](https://mobbin.com/screens/b9104519-abc8-4638-a2fc-206bea260188) | Grouped, scannable rows with a persistent sidebar and adjacent information panel. | Present prioritized insights as concise rows and reveal supporting detail nearby. Avoid borrowing its small typography. |
| [GitHub file-change review](https://mobbin.com/screens/bfd88cf5-a95a-444c-a520-3bd191335344) | Changed-file navigation sits beside highlighted diffs and an explicit review action. | Keep source selection, explanation, diff and approval together; add plain-language intent before code. |
| [PandaDoc monitoring empty state](https://mobbin.com/screens/79d68519-f53a-4cee-af87-32c39727a0dd) | Missing data is explained with a configuration action. | Missing context measurements should lead to collection or verification, rather than a wall of unknown values. Avoid its repeated empty panels. |

Impeccable's Shape and Operate guidance was applied to this brief. Its context-loader engine was unavailable; PRODUCT.md and the supplied screenshots provided the existing design context. No automated Impeccable UI audit or code refinement was performed in this documentation pass.

## Scope and delivery order

1. **Prove measurement feasibility:** establish what supported Claude Code and Codex sessions expose, how reliably startup can be captured, and whether per-source attribution is available. Publish an honest capability matrix inside the product.
2. **Deliver the complete first-use loop:** one project/agent, comprehensible source hierarchy, concise insights, one approved edit, backup/Undo, representative verification and an observed comparison. Validate this with a real setup before expanding the dashboard.
3. **Make returning worthwhile:** scoped change history, recurring mistakes, context regressions and usage evidence with coverage.
4. **Expand assistance:** guided new-project setup, generated reusable skills/scripts/workflows, journal-informed proposals and evaluated model delegation.

The order limits delivery batches, not the agreed product ambition. Avoid adding a general-purpose IDE, arbitrary workflow builder or a new agent platform as prerequisites. Native tray packaging is deferred; the browser utility comes first. A universal cross-agent health score, automatic deletion based on missing usage and a fixed eager/lazy policy for every repository are out of scope.

## Local data and public repository boundary

Maintain human-readable operational assets and memory as Markdown/HTML and structured conversations and measurements as JSON. Keep local runtime data separate from reusable public source. Do not publish inventories, transcripts, journals, configuration contents, credentials, screenshots or machine-specific paths. Agent requests should carry only the selected, necessary context and respect the user's chosen provider and data boundary.

Show storage footprint and offer previews for pruning generated operational data older than 24 hours, 7 days or 30 days. Distinguish generated history from source configuration, saved reusable components and recovery backups. Pruning must not silently remove material required for an available Undo action. Retention is separate from recommending retirement of a skill or MCP.

## Evidence of success and remaining questions

The primary outcome is completion of the first-use loop with a real measured result and a passing bounded task. Supporting measures are time to first useful insight, correct understanding of source/precedence, time to verified change, context change under comparable conditions, task failures/corrections, successful recovery, and recurring issues over time. These are proposed product measures, not a request to upload usage analytics.

Before implementation commitments, resolve:

- Which agent versions and launch modes expose reliable startup composition, source attribution and usage, and what remains inferred?
- How can a bounded verification run exercise the actual setup without unintended project changes?
- What automatic-apply scope and duration make consent clear, and how should concurrent edits be reconciled?
- What local collection cadence balances responsiveness, privacy, storage and resource use?

Next validation: use one consenting existing multi-agent project owner, observe them choose a project, explain its loading sources, fix one issue and interpret a real verification result without coaching. Then repeat with a beginner to check the language. Record where they hesitate and whether the ten-minute target is met; do not substitute a narrated demo for this test.
