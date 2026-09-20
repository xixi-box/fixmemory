import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createGitProject } from "./helpers.js";

test("official MCP client can list and call the FixMemory workflow", async () => {
  const root = mkdtempSync(join(tmpdir(), "fixmemory-mcp-"));
  const project = join(root, "project");
  createGitProject(project, "https://example.com/team/mcp-e2e.git");
  const runtime = resolve("runtime", "fixmemory-mcp.mjs");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [runtime],
    env: { FIXMEMORY_DATA_DIR: join(root, "data") },
    stderr: "pipe",
  });
  const client = new Client({ name: "fixmemory-test", version: "0.1.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      ["fixmemory_confirm", "fixmemory_feedback", "fixmemory_promote", "fixmemory_propose", "fixmemory_search"],
    );
    const proposal = await client.callTool({
      name: "fixmemory_propose",
      arguments: {
        scope: "project",
        project_path: project,
        symptom: "TypeError while loading MCP tools",
        root_cause: "The server returned a malformed input schema",
        solution: "Register a strict Zod object as the tool input schema",
        evidence: "tools/list showed the malformed schema before the change",
        environment: { node: "24" },
      },
    });
    assert.equal(proposal.isError, undefined);
    const proposalData = proposal.structuredContent as { id: string; status: string };
    assert.equal(proposalData.status, "candidate");

    const hidden = await client.callTool({
      name: "fixmemory_search",
      arguments: { query: "TypeError malformed MCP schema", project_path: project },
    });
    assert.equal((hidden.structuredContent as { count: number }).count, 0);

    const confirmation = await client.callTool({
      name: "fixmemory_confirm",
      arguments: { memory_id: proposalData.id, verification: "The MCP client listed and called all tools successfully" },
    });
    assert.equal((confirmation.structuredContent as { status: string }).status, "verified");

    const found = await client.callTool({
      name: "fixmemory_search",
      arguments: { query: "TypeError malformed MCP schema", project_path: project },
    });
    assert.equal((found.structuredContent as { count: number }).count, 1);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});
