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
