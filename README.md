# FixMemory

English | [简体中文](README.zh-CN.md)

### Help your coding agent avoid debugging the same bug twice.

[![npm version](https://img.shields.io/npm/v/fixmemory.svg)](https://www.npmjs.com/package/fixmemory)
[![CI](https://github.com/xixi-box/fixmemory/actions/workflows/ci.yml/badge.svg)](https://github.com/xixi-box/fixmemory/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/xixi-box/fixmemory.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

FixMemory is a local-first MCP server that turns successful debugging sessions into evidence-backed, reusable fixes. It searches project history before an agent starts from scratch, makes a lesson searchable only after the agent or user reports a passing check, and promotes it globally only after it works across projects.

**No account. No API key. No cloud database.**

Requires **Node.js 24+**. The installer currently runs on Windows, macOS, and Linux; real-agent end-to-end validation has been completed on Windows.

```bash
npx fixmemory@latest setup
```

Restart active agent sessions after setup.

## See it once. Reuse it next time.

```text
First encounter

Agent  → searches FixMemory
       → finds no matching fix
       → diagnoses the root cause
       → applies a change and runs the test
       → stores a verified project memory

Next encounter

Agent  → searches FixMemory
       → finds the verified fix
       → checks environment differences
       → applies it and verifies the result
```

The complete propose → confirm → search lifecycle is reproduced with the official MCP client in the [end-to-end test](tests/mcp-e2e.test.ts).

## Why not ordinary agent memory?

| Ordinary memory | FixMemory |
| --- | --- |
| Stores conversations, preferences, or notes | Stores symptom, root cause, solution, and evidence |
| New content is immediately reusable | New records stay hidden until verification succeeds |
| Context can leak across unrelated projects | Searches the current project first, then global memory |
| Old advice may look current | Reports environment mismatches with every result |
| Knowledge becomes global by default | Promotion requires successful reuse in two projects |
| Incorrect records are hard to govern | Feedback, superseding, replacement links, and guarded deletion |

FixMemory is deliberately narrower than a personal knowledge base. It remembers debugging experience, not conversations.

### FixMemory and GitNexus are complementary

[GitNexus](https://github.com/digitalapplied/gitnexus) builds a graph of the code that exists now: dependencies, call paths, and change impact. FixMemory preserves what happened before: the symptom, root cause, successful change, and verification evidence from earlier debugging sessions.

Use GitNexus to understand the current codebase. Use FixMemory to avoid repeating previously solved investigations.

## The verification loop

```mermaid
flowchart LR
    A[Search past fixes] --> B[Debug normally]
    B --> C[Propose candidate]
    C --> D[Agent or user runs a check]
    D -->|failed| B
    D -->|passed| E[Verified project memory]
    E --> F[Helpful in other projects]
    F --> G[Global candidate]
    G --> H[Verify again]
```

Candidates do not appear in normal search. A verified memory that becomes outdated can be superseded, preserving the reason and optional replacement while removing it from future search.

### What “verified” means

FixMemory does not prove a root cause by itself. The agent or user runs the relevant test, build, reproduction, or operational check and submits a description of the successful result. FixMemory enforces the candidate → verified state transition and stores that evidence.

A passing check makes a record eligible for search; it does not make the advice universally correct. Search results remain hypotheses, include environment mismatches, and can receive irrelevant or harmful feedback.

## MCP + Skill

FixMemory installs two small layers:

- **MCP server:** owns the portable tools and local SQLite database.
- **Shared Skill:** teaches compatible agents when to search, verify, record feedback, and retire bad memory.

MCP makes the data available across Harnesses. The Skill turns those tools into a disciplined debugging workflow. An MCP-compatible client that does not discover shared Skills can still use every tool through its own instructions.

## Harness support maturity

| Harness | Setup | Current evidence |
| --- | --- | --- |
| Local Coding Agent | One command | Real model + MCP end-to-end on Windows |
| Codex | One command | Configuration adapter + MCP protocol test |
| zCode | One command | Configuration adapter test |
| Other MCP clients | Adapter required | Standard stdio MCP server |

Unattended setup is also available:

```bash
npx fixmemory@latest setup --agents codex,zcode,local-agent
```

Without `--agents`, setup detects supported Harness directories, asks which ones to enable, installs the shared runtime and Skill, and adds only a managed `fixmemory` entry to the selected configuration files. Existing files are backed up first.

Claude Code, Cursor, OpenCode, VS Code, and additional Harness installers are on the roadmap. Contributions for small configuration adapters are welcome; see [Adding a Harness adapter](CONTRIBUTING.md#adding-a-harness-adapter).

## Tools

| Tool | Purpose |
| --- | --- |
| `fixmemory_search` | Find verified project fixes, then global fixes |
| `fixmemory_get` | Inspect one record, including audit metadata |
| `fixmemory_list` | Audit memories with status filters and pagination |
| `fixmemory_propose` | Create an unverified candidate |
| `fixmemory_confirm` | Make a candidate searchable after a successful check |
| `fixmemory_feedback` | Record helpful, irrelevant, or harmful reuse |
| `fixmemory_promote` | Create a global candidate after cross-project reuse |
| `fixmemory_supersede` | Retire outdated memory and optionally link a replacement |
| `fixmemory_delete` | Permanently remove a candidate or superseded record |

Destructive tools are explicitly annotated. Verified records cannot be directly deleted: supersede them first so the audit trail remains intentional.

## Local data and privacy

The machine-local database is stored at:

```text
~/.fixmemory/data/memory.db
```

FixMemory does not upload debugging memory. It uses SQLite WAL mode so several local MCP processes can share one database, rejects content that resembles credentials or private keys, and hashes project identity from the Git remote when available.

“Global” means available across projects on the same machine and user account. It does not mean uploaded or shared online. On Windows, `~` is the current user's home directory, such as `C:\Users\name`.

Secret detection is a safety net, not a guarantee. Memory text may contain paths, commands, stack traces, or code fragments supplied by an agent. Do not intentionally submit credentials, tokens, private keys, proprietary source, or unsanitized production data.

## Commands

```bash
# Install, upgrade, or repair selected integrations
npx fixmemory@latest setup

# Verify the installed runtime and MCP tool discovery
npx fixmemory@latest doctor

# Remove integrations and runtime, preserving memory data
npx fixmemory@latest uninstall

# Also delete the local memory database
npx fixmemory@latest uninstall --delete-data
```

Setup backs up existing Harness configuration files before changing them. Re-running setup is safe, and uninstall removes only FixMemory-managed entries.

## Development

Requires Node.js 24 or newer.

```bash
npm install
npm run check
```

`npm run check` performs strict type checking, builds the bundled runtime, runs store/MCP/installer tests, and inspects the npm tarball. CI runs the same gate on Windows, macOS, and Linux.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## Roadmap

- One-command adapters for Claude Code, Cursor, OpenCode, and VS Code
- Export and import for portable backups
- A reproducible debugging-search evaluation set before changing retrieval engines
- More real-Harness compatibility tests

FixMemory intentionally starts with deterministic local retrieval. Semantic search will be considered only when evaluation data shows that it improves real debugging recall.

## License

[MIT](LICENSE)
