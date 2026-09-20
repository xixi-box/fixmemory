# FixMemory Agent Guidelines

## Product

FixMemory is a local-first, Harness-agnostic debugging memory layer for coding agents. The public interface is MCP; a compact Skill teaches agents when to search and when a fix is sufficiently verified to retain.

## Invariants

- Search project-scoped verified memories before global verified memories.
- Treat memories as hypotheses, never as proof for the current environment.
- Never turn an unverified proposal into durable verified memory without explicit verification evidence.
- Reject likely credentials and secrets instead of storing or echoing them.
- Keep user data local by default and never require a hosted service.
- Setup must preserve unrelated Harness configuration and be safe to repeat.
- Uninstall removes only FixMemory-managed integration; preserve the memory database unless explicitly requested.

## Commands

```powershell
npm run typecheck
npm test
npm run build
npm run check
```

Do not claim an integration works until a real MCP client lists and calls its tools.
