import type { MemoryMatch } from "./types.js";

const DEFAULT_BASE_URL = "https://www.jevai.org";
const DEFAULT_MODEL = "typesafe-ai/jev";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_DELAY_MS = 8_000;
const RELEVANCE_QUESTION = "Is this stored debugging fix relevant to the current problem and worth reading?";

export interface JevCandidate {
  symptom: string;
  rootCause: string;
  solution: string;
}

export interface JevClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

export interface JevClient {
  model: string;
  /**
   * Scores every candidate in ONE decisions call: the whole batch rides a
   * single request so a page of matches costs one rate-limit slot, not one
   * slot per match. Returns probabilities aligned with the input order.
   */
  relevanceScores(problem: string, candidates: JevCandidate[], signal?: AbortSignal): Promise<number[]>;
}

export interface JevReranker {
  model: string;
  rerank(query: string, matches: MemoryMatch[]): Promise<MemoryMatch[]>;
}

export function createJevClient(options: JevClientOptions): JevClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = options.model ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const doFetch = options.fetch ?? fetch;
  const request = (problem: string, candidates: JevCandidate[], signal?: AbortSignal): Promise<Response> => {
    const questions: Record<string, { type: string; instructions: string }> = {};
    for (let index = 0; index < candidates.length; index += 1) {
      questions[`m${index}`] = { type: "noul", instructions: RELEVANCE_QUESTION };
    }
    const timer = new AbortController();
    const timeout = setTimeout(() => timer.abort(new Error(`Jev request timed out after ${timeoutMs}ms`)), timeoutMs);
    const abort = signal === undefined ? timer.signal : AbortSignal.any([timer.signal, signal]);
    return doFetch(`${baseUrl}/api/v1/decisions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        state: {
          problem,
          candidates: candidates.map((candidate) => ({
            symptom: candidate.symptom,
            root_cause: candidate.rootCause,
            solution: candidate.solution,
          })),
        },
        questions,
      }),
      signal: abort,
    }).finally(() => clearTimeout(timeout));
  };
  return {
    model,
    async relevanceScores(problem, candidates, signal) {
      if (candidates.length === 0) return [];
      let response = await request(problem, candidates, signal);
      if (response.status === 429 && retryDelayMs > 0) {
        // The community endpoint allows roughly one request per minute; one
        // backoff keeps a whole search alive before degrading.
        await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelayMs));
        response = await request(problem, candidates, signal);
      }
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(`Jev API ${response.status}: ${detail}`);
      }
      const payload = (await response.json()) as {
        code?: unknown;
        message?: unknown;
        data?: { answers?: Record<string, unknown> } | null;
      };
      if (payload.code !== 0) {
        throw new Error(`Jev API error (code ${String(payload.code)}): ${String(payload.message).slice(0, 200)}`);
      }
      const answers = payload.data?.answers ?? {};
      return candidates.map((_, index) => {
        const answer = answers[`m${index}`];
        const probability = typeof answer === "object" && answer !== null ? (answer as { noul?: unknown }).noul : answer;
        if (typeof probability !== "number" || !Number.isFinite(probability)) {
          throw new Error(`Jev API returned no numeric probability for candidate ${index}`);
        }
        return probability;
      });
    },
  };
}

export function createJevReranker(client: JevClient): JevReranker {
  return {
    model: client.model,
    async rerank(query, matches) {
      if (matches.length === 0) return matches;
      const scores = await client.relevanceScores(
        query,
        matches.map((match) => match.memory),
      );
      return matches
        .map((match, index) => ({ match, index, relevance: scores[index] ?? 0 }))
        .sort((left, right) => right.relevance - left.relevance || left.index - right.index)
        .map(({ match, index, relevance }) => ({
          ...match,
          jevRelevance: Number(relevance.toFixed(4)),
          jevRankBefore: index,
        }));
    },
  };
}

/**
 * The Jev rerank is strictly opt-in: behavior changes only when both
 * FIXMEMORY_JEV_RERANK=1 and TYPESAFE_API_KEY are set, so a default install
 * keeps its deterministic, fully local search untouched.
 */
export function createJevRerankerFromEnv(env: NodeJS.ProcessEnv): JevReranker | undefined {
  if (env.FIXMEMORY_JEV_RERANK !== "1") return undefined;
  const apiKey = env.TYPESAFE_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") return undefined;
  const client = createJevClient({
    apiKey,
    ...(env.TYPESAFE_BASE_URL === undefined ? {} : { baseUrl: env.TYPESAFE_BASE_URL }),
  });
  return createJevReranker(client);
}
