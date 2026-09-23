import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createJevClient, createJevReranker, createJevRerankerFromEnv } from "../src/core/jev.js";
import type { MemoryMatch } from "../src/core/types.js";
import { createGitProject } from "./helpers.js";

function jevMatch(id: string, symptom: string): MemoryMatch {
  return {
    memory: {
      id,
      scope: "project",
      symptom,
      rootCause: "cause",
      solution: "solution",
      evidence: "evidence",
      environment: {},
      status: "verified",
      fingerprint: id,
      createdAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T00:00:00.000Z",
      helpfulCount: 0,
      irrelevantCount: 0,
      harmfulCount: 0,
    },
    score: 1,
    matchedTerms: [],
    environmentMismatches: [],
  };
}

test("jev client scores a whole page of matches in one decisions call", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const doFetch = (async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        code: 0,
        message: "ok",
        data: { answers: { m0: { type: "noul", noul: 0.91 }, m1: { type: "noul", noul: 0.12 } } },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const client = createJevClient({ apiKey: "test-key", fetch: doFetch, retryDelayMs: 0 });
  const scores = await client.relevanceScores("some problem", [
    { symptom: "a", rootCause: "b", solution: "c" },
    { symptom: "d", rootCause: "e", solution: "f" },
  ]);
  assert.deepEqual(scores, [0.91, 0.12]);
  const request = requests[0];
  assert.equal(request?.url, "https://www.jevai.org/api/v1/decisions");
  assert.equal((request?.init.headers as Record<string, string>).Authorization, "Bearer test-key");
  const body = JSON.parse(String(request?.init.body)) as {
    model: string;
    state: { problem: string; candidates: unknown[] };
    questions: Record<string, { type: string; instructions: string }>;
  };
  assert.equal(body.model, "typesafe-ai/jev");
  assert.equal(body.state.problem, "some problem");
  assert.equal(body.state.candidates.length, 2);
  assert.deepEqual(Object.keys(body.questions), ["m0", "m1"]);
  assert.equal(requests.length, 1);
});

test("jev reranker reorders matches and keeps the deterministic rank", async () => {
  const reranker = createJevReranker({ model: "jev-fake", relevanceScores: async () => [0.2, 0.9] });
  const reranked = await reranker.rerank("query", [jevMatch("first", "a"), jevMatch("second", "b")]);
  assert.deepEqual(reranked.map((match) => match.memory.id), ["second", "first"]);
  assert.equal(reranked[0]?.jevRelevance, 0.9);
  assert.equal(reranked[0]?.jevRankBefore, 1);
  assert.equal(reranked[1]?.jevRankBefore, 0);
});

test("jev client retries once after a rate limit", async () => {
  let calls = 0;
  const doFetch = (async () => {
    calls += 1;
    const status = calls === 1 ? 429 : 200;
    return new Response(
      JSON.stringify(
        status === 429
          ? { code: -1, message: "Too many requests.", data: null }
          : { code: 0, message: "ok", data: { answers: { m0: { type: "noul", noul: 0.4 } } } },
      ),
      { status },
    );
  }) as typeof fetch;
  const client = createJevClient({ apiKey: "k", fetch: doFetch, retryDelayMs: 1 });
  const scores = await client.relevanceScores("p", [{ symptom: "s", rootCause: "c", solution: "s" }]);
  assert.deepEqual(scores, [0.4]);
  assert.equal(calls, 2);
});

test("reranker stays disabled unless both env vars are set", () => {
  assert.equal(createJevRerankerFromEnv({}), undefined);
  assert.equal(createJevRerankerFromEnv({ FIXMEMORY_JEV_RERANK: "1" }), undefined);
  assert.equal(createJevRerankerFromEnv({ TYPESAFE_API_KEY: "k" }), undefined);
  assert.ok(createJevRerankerFromEnv({ FIXMEMORY_JEV_RERANK: "1", TYPESAFE_API_KEY: "k" }));
});

type SearchPayload = {
  count: number;
  matches: { id: string; score: number; jev_relevance?: number; jev_rank_before?: number }[];
  jev_rerank?: { applied: boolean; model: string };
};

async function startRuntime(extraEnv: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "fixmemory-jev-"));
  const project = join(root, "project");
  createGitProject(project, "https://example.com/team/jev-e2e.git");
  const runtime = resolve("runtime", "fixmemory-mcp.mjs");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [runtime],
    env: { FIXMEMORY_DATA_DIR: join(root, "data"), ...extraEnv },
    stderr: "pipe",
  });
  const client = new Client({ name: "fixmemory-jev-test", version: "0.2.0" });
  await client.connect(transport);
  return { client, project, root };
}

async function seedVerifiedPair(client: Client, project: string): Promise<[string, string]> {
  const first = await client.callTool({
    name: "fixmemory_propose",
    arguments: {
      scope: "project",
      project_path: project,
      symptom: "docker compose postgres connection refused on port 5432",
      root_cause: "the db service was not up",
      solution: "start the db service before the agent",
      evidence: "reproduced and fixed during the test",
      environment: {},
    },
  });
  const second = await client.callTool({
    name: "fixmemory_propose",
    arguments: {
      scope: "project",
      project_path: project,
      symptom: "postgres unreachable after reboot",
      root_cause: "the container restart policy was missing",
      solution: "add a restart policy to the db service",
      evidence: "reproduced and fixed during the test",
      environment: {},
    },
  });
  for (const proposal of [first, second]) {
    const id = (proposal.structuredContent as { id: string }).id;
    await client.callTool({ name: "fixmemory_confirm", arguments: { memory_id: id, verification: "The e2e verification command succeeded" } });
  }
  const firstId = (first.structuredContent as { id: string }).id;
  const secondId = (second.structuredContent as { id: string }).id;
  return [firstId, secondId];
}

async function searchAll(client: Client, project: string): Promise<SearchPayload> {
  const found = await client.callTool({
    name: "fixmemory_search",
    arguments: { query: "docker postgres connection refused", project_path: project },
  });
  return found.structuredContent as SearchPayload;
}

test("enabled Jev rerank reorders search results through the real MCP runtime", async () => {
  const mock = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          code: 0,
          message: "ok",
          data: { answers: { m0: { type: "noul", noul: 0.1 }, m1: { type: "noul", noul: 0.95 } } },
        }),
      );
    });
  });
  await new Promise<void>((resolveListen) => mock.listen(0, "127.0.0.1", resolveListen));
  const address = mock.address() as { port: number };
  const { client, project, root } = await startRuntime({
    FIXMEMORY_JEV_RERANK: "1",
    TYPESAFE_API_KEY: "test-key",
    TYPESAFE_BASE_URL: `http://127.0.0.1:${address.port}`,
  });
  try {
    const [deterministicFirst, deterministicSecond] = await seedVerifiedPair(client, project);
    const payload = await searchAll(client, project);
    assert.equal(payload.count, 2);
    assert.deepEqual(payload.matches.map((match) => match.id), [deterministicSecond, deterministicFirst]);
    assert.equal(payload.matches[0]?.jev_relevance, 0.95);
    assert.equal(payload.matches[0]?.jev_rank_before, 1);
    assert.equal(payload.matches[1]?.jev_relevance, 0.1);
    assert.equal(payload.matches[1]?.jev_rank_before, 0);
    assert.deepEqual(payload.jev_rerank, { applied: true, model: "typesafe-ai/jev" });
  } finally {
    await client.close();
    mock.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("unreachable Jev endpoint keeps deterministic order without jev fields", async () => {
  const { client, project, root } = await startRuntime({
    FIXMEMORY_JEV_RERANK: "1",
    TYPESAFE_API_KEY: "test-key",
    TYPESAFE_BASE_URL: "http://127.0.0.1:9",
  });
  try {
    const [deterministicFirst, deterministicSecond] = await seedVerifiedPair(client, project);
    const payload = await searchAll(client, project);
    assert.equal(payload.count, 2);
    assert.deepEqual(payload.matches.map((match) => match.id), [deterministicFirst, deterministicSecond]);
    assert.equal(payload.matches[0]?.jev_relevance, undefined);
    assert.equal(payload.jev_rerank, undefined);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});
