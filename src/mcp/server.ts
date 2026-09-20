import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { MemoryStore } from "../core/store.js";
import type { FeedbackResult, MemoryMatch, MemoryScope } from "../core/types.js";

const EnvironmentSchema = z.record(z.string(), z.string()).default({});

const SearchInputSchema = z.strictObject({
  query: z.string().min(3).max(8_000).describe("Error text, stack trace, symptom, or debugging context to search for."),
  project_path: z.string().min(1).max(2_000).optional().describe("Current workspace path. Required to search project-scoped memory."),
  environment: EnvironmentSchema.describe("Relevant facts such as os, runtime, framework, and dependency versions."),
  limit: z.number().int().min(1).max(20).default(5),
  include_candidates: z.boolean().default(false).describe("Include unverified candidate memories. Keep false during normal debugging."),
});

const ProposeInputSchema = z.strictObject({
  scope: z.enum(["project", "global"]).default("project"),
  project_path: z.string().min(1).max(2_000).optional(),
  symptom: z.string().min(3).max(8_000),
  root_cause: z.string().min(3).max(8_000),
  solution: z.string().min(3).max(12_000),
  evidence: z.string().min(3).max(8_000).describe("Current evidence. This creates a candidate; confirmation still requires successful verification."),
  environment: EnvironmentSchema,
});

const ConfirmInputSchema = z.strictObject({
  memory_id: z.string().uuid(),
  verification: z.string().min(8).max(8_000).describe("Successful test, build, reproduction, or observed result proving the fix."),
});

const FeedbackInputSchema = z.strictObject({
  memory_id: z.string().uuid(),
  project_path: z.string().min(1).max(2_000),
  result: z.enum(["helpful", "irrelevant", "harmful"]),
});

const PromoteInputSchema = z.strictObject({
  memory_id: z.string().uuid(),
  reason: z.string().min(8).max(4_000).describe("Why this verified fix generalizes beyond its original project."),
});

function jsonResult(value: Record<string, unknown>): {
  content: [{ type: "text"; text: string }];
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function errorResult(error: unknown): {
  isError: true;
  content: [{ type: "text"; text: string }];
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: `FixMemory error: ${message}` }],
  };
}

function publicMatch(match: MemoryMatch): Record<string, unknown> {
  return {
    id: match.memory.id,
    scope: match.memory.scope,
    project_label: match.memory.projectLabel ?? null,
    symptom: match.memory.symptom,
    root_cause: match.memory.rootCause,
    solution: match.memory.solution,
    evidence: match.memory.evidence,
    environment: match.memory.environment,
    status: match.memory.status,
    score: match.score,
    matched_terms: match.matchedTerms,
    environment_mismatches: match.environmentMismatches,
    feedback: {
      helpful: match.memory.helpfulCount,
      irrelevant: match.memory.irrelevantCount,
      harmful: match.memory.harmfulCount,
    },
  };
}

export function createFixMemoryServer(store: MemoryStore): McpServer {
  const server = new McpServer(
    { name: "fixmemory-mcp-server", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "fixmemory_search",
    {
      title: "Search verified debugging memory",
      description: "Search project-scoped verified fixes first, then global verified fixes. Results are hypotheses and include environment mismatches; verify them against the current project before applying.",
      inputSchema: SearchInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, project_path, environment, limit, include_candidates }) => {
      try {
        const matches = store.search({
          query,
          ...(project_path ? { projectPath: project_path } : {}),
          environment,
          limit,
          includeCandidates: include_candidates,
        });
        return jsonResult({
          count: matches.length,
          matches: matches.map(publicMatch),
          guidance: matches.length === 0
            ? "No reusable fix matched. Continue normal debugging, then propose a memory only after identifying a root cause."
            : "Treat matches as leads, check environment mismatches, and verify the current fix independently.",
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fixmemory_propose",
    {
      title: "Propose a debugging memory",
      description: "Create an unverified candidate from a diagnosed failure. This does not make the memory visible to normal searches until fixmemory_confirm records successful verification.",
      inputSchema: ProposeInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ scope, project_path, symptom, root_cause, solution, evidence, environment }) => {
      try {
        const result = store.propose({
          scope: scope as MemoryScope,
          ...(project_path ? { projectPath: project_path } : {}),
          symptom,
          rootCause: root_cause,
          solution,
          evidence,
          environment,
        });
        return jsonResult({
          id: result.memory.id,
          status: result.memory.status,
          duplicate: result.duplicate,
          next_step: result.memory.status === "candidate"
            ? "Run a relevant test, build, or reproduction, then call fixmemory_confirm with the evidence."
            : "This memory was already verified.",
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fixmemory_confirm",
    {
      title: "Confirm a verified debugging memory",
      description: "Promote a candidate to verified memory only after a successful test, build, reproduction, or observed result. Verification text is stored as evidence.",
      inputSchema: ConfirmInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ memory_id, verification }) => {
      try {
        const memory = store.confirm(memory_id, verification);
        return jsonResult({ id: memory.id, status: memory.status, verified_at: memory.verifiedAt ?? null });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fixmemory_feedback",
    {
      title: "Rate a debugging memory",
      description: "Record whether a retrieved memory was helpful, irrelevant, or harmful in the current project. Re-rating from the same project replaces its previous rating.",
      inputSchema: FeedbackInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ memory_id, project_path, result }) => {
      try {
        const memory = store.feedback(memory_id, project_path, result as FeedbackResult);
        return jsonResult({
          id: memory.id,
          feedback: {
            helpful: memory.helpfulCount,
            irrelevant: memory.irrelevantCount,
            harmful: memory.harmfulCount,
          },
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fixmemory_promote",
    {
      title: "Promote project memory to global",
      description: "Create a global candidate from a verified project memory after it has helpful feedback from at least two distinct projects. Confirm the resulting candidate separately.",
      inputSchema: PromoteInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ memory_id, reason }) => {
      try {
        const result = store.promote(memory_id, reason);
        return jsonResult({
          id: result.memory.id,
          status: result.memory.status,
          duplicate: result.duplicate,
          next_step: "Confirm the global candidate with cross-project verification evidence.",
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
