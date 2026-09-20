# FixMemory

FixMemory gives coding agents a shared, verified memory of debugging failures and fixes. Memories belong to the user and project rather than to a single Agent Harness.

## Why it exists

Ordinary agent memory tends to retain conversation details or notes. FixMemory keeps a narrower contract:

- Search project-scoped fixes before global fixes.
- Keep new records hidden as candidates until a test, build, reproduction, or observed result verifies them.
- Show environment mismatches so an old fix is treated as a hypothesis, not current truth.
- Collect helpful, irrelevant, and harmful feedback per project.
- Require successful reuse in two projects before a project memory can be promoted toward global scope.
- Reject content that resembles credentials, access tokens, or private keys.

## Install

Requires Node.js 24 or newer.

```powershell
npx fixmemory@latest setup
```

The interactive setup detects supported Harnesses and lets the user choose which ones to enable. It then:

1. Installs a stable bundled MCP runtime under `~/.fixmemory/runtime`.
2. Installs the shared Skill under `~/.agents/skills/fixmemory`.
3. Adds only the `fixmemory` MCP entry to each selected Harness configuration.
4. Probes the installed runtime with an MCP 2024-11-05 handshake before reporting success.

Active Agent sessions must be restarted after setup.

For unattended setup:

```powershell
npx fixmemory@latest setup --agents codex,zcode,local-agent
```

## Commands

```powershell
# Install, upgrade, or repair selected integrations
npx fixmemory@latest setup

# Verify the installed runtime and tool discovery
npx fixmemory@latest doctor

# Remove integrations and runtime while preserving memory data
npx fixmemory@latest uninstall

# Also delete the local memory database
npx fixmemory@latest uninstall --delete-data
```

## MCP tools

| Tool | Purpose |
| --- | --- |
| `fixmemory_search` | Search project verified memory first, then global verified memory |
| `fixmemory_propose` | Create a candidate with symptom, root cause, solution, evidence, and environment |
| `fixmemory_confirm` | Make a candidate searchable after successful verification |
| `fixmemory_feedback` | Record helpful, irrelevant, or harmful reuse in one project |
| `fixmemory_promote` | Create a global candidate after verified cross-project reuse |

## Supported Harnesses

| Harness | Setup adapter | Verification status |
| --- | --- | --- |
| Local Coding Agent | `mcpServers.fixmemory` | Real model and MCP end-to-end verified on Windows |
| Codex | `mcp_servers.fixmemory` | Configuration and MCP protocol adapter tested |
| zCode | `mcp.servers.fixmemory` | Configuration adapter tested; stdio console behavior depends on the host version |

The MCP server is Harness-independent. Additional Harnesses need only a small configuration adapter and a way to discover the shared Skill.

## Local data and privacy

The default database is:

```text
~/.fixmemory/data/memory.db
```

The database uses SQLite WAL mode and a busy timeout so several local stdio MCP processes can share it. FixMemory does not upload debugging memory or require a hosted account.

Setup backs up configuration files before changing them. Re-running setup is safe, and uninstall removes only FixMemory-managed entries. Memory data is preserved unless `--delete-data` is explicitly supplied.

## Development

```powershell
npm install
npm run check
```

`npm run check` performs strict type checking, builds the bundled runtime, runs store/MCP/installer tests, and inspects the npm tarball.
