import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { MemoryStore } from "../core/store.js";
import { createJevRerankerFromEnv, type JevReranker } from "../core/jev.js";
import type { DebugMemory, FeedbackResult, MemoryMatch, MemoryScope } from "../core/types.js";

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

const GetInputSchema = z.strictObject({
  memory_id: z.string().uuid(),
});

const ListInputSchema = z.strictObject({
  project_path: z.string().min(1).max(2_000).optional().describe("Current workspace path. Without it, only global memory can be listed."),
  scope: z.enum(["project", "global", "all"]).default("all"),
  status: z.enum(["candidate", "verified", "superseded", "all"]).default("verified"),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

const SupersedeInputSchema = z.strictObject({
  memory_id: z.string().uuid(),
  reason: z.string().min(8).max(4_000).describe("Why the memory is outdated, incorrect, or unsafe to reuse."),
  replacement_id: z.string().uuid().optional().describe("Optional verified memory that replaces this one in the same scope."),
});

const DeleteInputSchema = z.strictObject({
  memory_id: z.string().uuid(),
  confirm: z.literal(true).describe("Must be true. Verified memories must be superseded before deletion."),
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
    ...publicMemory(match.memory),
    score: match.score,
    matched_terms: match.matchedTerms,
    environment_mismatches: match.environmentMismatches,
    ...(match.jevRelevance === undefined ? {} : { jev_relevance: match.jevRelevance }),
    ...(match.jevRankBefore === undefined ? {} : { jev_rank_before: match.jevRankBefore }),
  };
}

function publicMemory(memory: DebugMemory): Record<string, unknown> {
  return {
    id: memory.id,
    scope: memory.scope,
    project_label: memory.projectLabel ?? null,
    symptom: memory.symptom,
    root_cause: memory.rootCause,
    solution: memory.solution,
    evidence: memory.evidence,
    environment: memory.environment,
    status: memory.status,
    created_at: memory.createdAt,
    verified_at: memory.verifiedAt ?? null,
    superseded_at: memory.supersededAt ?? null,
    superseded_reason: memory.supersededReason ?? null,
    replacement_id: memory.replacementId ?? null,
    updated_at: memory.updatedAt,
    feedback: {
      helpful: memory.helpfulCount,
      irrelevant: memory.irrelevantCount,
      harmful: memory.harmfulCount,
    },
  };
}

export function createFixMemoryServer(store: MemoryStore, options: { env?: NodeJS.ProcessEnv } = {}): McpServer {
  const reranker: JevReranker | undefined = createJevRerankerFromEnv(options.env ?? process.env);
  const server = new McpServer(
    { name: "fixmemory-mcp-server", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "fixmemory_get",
    {
      title: "Get a debugging memory",
      description: "Get one memory by ID, including candidate and superseded records. Use this to inspect its status, evidence, feedback, and replacement metadata.",
      inputSchema: GetInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ memory_id }) => {
      try {
        return jsonResult(publicMemory(store.get(memory_id)));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fixmemory_list",
    {
      title: "List debugging memories",
      description: "List project-visible or global memories with status filters and offset pagination. Without project_path, project-scoped records are intentionally excluded.",
      inputSchema: ListInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_path, scope, status, limit, offset }) => {
      try {
        const result = store.list({
          ...(project_path ? { projectPath: project_path } : {}),
          scope,
          status,
          limit,
          offset,
        });
        return jsonResult({
          total: result.total,
          count: result.items.length,
          offset: result.offset,
          has_more: result.hasMore,
          next_offset: result.nextOffset ?? null,
          memories: result.items.map(publicMemory),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fixmemory_search",
    {
      title: "Search verified debugging memory",
      description: "Search project-scoped verified fixes first, then global verified fixes. Results are hypotheses and include environment mismatches; verify them against the current project before applying. When the optional Jev rerank is enabled, matches are re-ordered by a cloud relevance model and the query plus candidate fix text are sent to jevai.org.",
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
        let matches = store.search({
          query,
          ...(project_path ? { projectPath: project_path } : {}),
          environment,
          limit,
          includeCandidates: include_candidates,
        });
        let jevRerank: { applied: boolean; model: string } | undefined;
        if (reranker !== undefined && matches.length > 0) {
          try {
            matches = await reranker.rerank(query, matches);
            jevRerank = { applied: true, model: reranker.model };
          } catch (rerankError) {
            const rerankMessage = rerankError instanceof Error ? rerankError.message : String(rerankError);
            console.error(`FixMemory: Jev rerank skipped, keeping deterministic order: ${rerankMessage}`);
          }
        }
        return jsonResult({
          count: matches.length,
          matches: matches.map(publicMatch),
          ...(jevRerank === undefined ? {} : { jev_rerank: jevRerank }),
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

  server.registerTool(
    "fixmemory_supersede",
    {
      title: "Supersede an outdated debugging memory",
      description: "Remove an outdated or incorrect memory from normal search while preserving an audit trail. Optionally link a verified replacement in the same scope.",
      inputSchema: SupersedeInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ memory_id, reason, replacement_id }) => {
      try {
        const memory = store.supersede(memory_id, reason, replacement_id);
        return jsonResult(publicMemory(memory));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fixmemory_delete",
    {
      title: "Delete an unverified or superseded memory",
      description: "Permanently delete a candidate or superseded memory. Requires confirm=true. Verified memory must be superseded first so accidental deletion cannot erase trusted history.",
      inputSchema: DeleteInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ memory_id }) => {
      try {
        const deleted = store.delete(memory_id);
        return jsonResult({ id: deleted.id, deleted: true, previous_status: deleted.status });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
