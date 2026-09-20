---
name: fixmemory
description: Search and maintain verified debugging memory when diagnosing errors, repeated failures, environment problems, or fixes that may recur across coding-agent sessions. Use for debugging; do not use as a general note-taking or conversation-memory system.
---

# FixMemory

Use FixMemory to reuse evidence-backed debugging experience without treating old fixes as current truth.

## Before debugging

Call `fixmemory_search` with the current error or symptom, the workspace path, and relevant environment versions. Review project-scoped matches before global matches.

- Treat every match as a hypothesis.
- Check environment mismatches before applying a fix.
- If no useful match exists, continue normal debugging.
- Record `irrelevant` or `harmful` feedback when a retrieved memory wastes time or points in the wrong direction.

## After finding a root cause

Call `fixmemory_propose` only when the symptom, root cause, and concrete solution are known. Prefer project scope. Do not include credentials, private keys, access tokens, or unredacted sensitive values.

The proposal remains a candidate. Run the relevant test, build, reproduction, or operational check. Only after that succeeds, call `fixmemory_confirm` with specific verification evidence.

Do not record trivial typos, speculative fixes, raw logs, or facts that are obvious from the current codebase.

## Reuse and promotion

After a memory helps in another project, call `fixmemory_feedback`. Promote a project memory to a global candidate only after it has been independently helpful in at least two projects, then verify the promoted candidate again.

## Memory maintenance

Use `fixmemory_get` to inspect a specific record and `fixmemory_list` to audit candidates, verified memories, or superseded history. Do not retrieve unrelated project memory.

When a verified memory becomes incorrect or outdated, call `fixmemory_supersede` with a concrete reason. Link a verified replacement when one exists. Superseded memory stays available for audit but disappears from normal search.

Use `fixmemory_delete` only for abandoned candidates or records that have already been superseded. Never delete a verified memory merely because it did not apply to one case; record `irrelevant` or `harmful` feedback instead.
