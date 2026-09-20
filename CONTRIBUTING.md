# Contributing to FixMemory

Thanks for helping coding agents avoid repeated debugging work.

## Before opening a change

- Keep FixMemory focused on verified debugging memory rather than general notes or conversation history.
- Open an issue before introducing a hosted service, vector database, account system, or new persistent dependency.
- Never add real credentials, private logs, or production data to fixtures.

## Development

FixMemory requires Node.js 24 or newer.

```bash
npm install
npm run check
```

Every behavior change should include a focused test. `npm run check` must pass on Windows, macOS, and Linux.

## Adding a Harness adapter

A setup adapter should:

1. Preserve unrelated user configuration.
2. Back up a file before changing it.
3. Make repeated setup idempotent.
4. Remove only FixMemory-managed configuration during uninstall.
5. Include an adapter test and clearly state whether it has passed a real-Harness test.

Do not advertise a Harness as end-to-end verified until an actual agent has discovered and called the installed MCP tools.

## Pull requests

Describe the user-visible problem, the smallest solution, and the command or scenario used to verify it. Keep unrelated refactors out of the same pull request.
