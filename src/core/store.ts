import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveProjectIdentity } from "./project.js";
import { scoreMemory } from "./search.js";
import { assertNoLikelySecret } from "./security.js";
import type {
  DebugMemory,
  EnvironmentFacts,
  FeedbackResult,
  MemoryMatch,
  ProposeMemoryInput,
  SearchMemoryInput,
} from "./types.js";

interface MemoryRow {
  id: string;
  scope: "project" | "global";
  project_key: string | null;
  project_label: string | null;
  symptom: string;
  root_cause: string;
  solution: string;
  evidence: string;
  environment_json: string;
  status: "candidate" | "verified" | "superseded";
  fingerprint: string;
  created_at: string;
  verified_at: string | null;
  updated_at: string;
  helpful_count: number;
  irrelevant_count: number;
  harmful_count: number;
}

function mapRow(row: MemoryRow): DebugMemory {
  return {
    id: row.id,
    scope: row.scope,
    ...(row.project_key ? { projectKey: row.project_key } : {}),
    ...(row.project_label ? { projectLabel: row.project_label } : {}),
    symptom: row.symptom,
    rootCause: row.root_cause,
    solution: row.solution,
    evidence: row.evidence,
    environment: JSON.parse(row.environment_json) as EnvironmentFacts,
    status: row.status,
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
    ...(row.verified_at ? { verifiedAt: row.verified_at } : {}),
    updatedAt: row.updated_at,
    helpfulCount: row.helpful_count,
    irrelevantCount: row.irrelevant_count,
    harmfulCount: row.harmful_count,
  };
}

function fingerprint(input: ProposeMemoryInput, projectKey?: string): string {
  const normalized = [
    input.scope,
    projectKey ?? "global",
    input.symptom,
    input.rootCause,
    input.solution,
  ]
    .join("\n")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export class MemoryStore {
  readonly #database: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK (scope IN ('project', 'global')),
        project_key TEXT,
        project_label TEXT,
        symptom TEXT NOT NULL,
        root_cause TEXT NOT NULL,
        solution TEXT NOT NULL,
        evidence TEXT NOT NULL,
        environment_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('candidate', 'verified', 'superseded')),
        fingerprint TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        verified_at TEXT,
        updated_at TEXT NOT NULL,
        helpful_count INTEGER NOT NULL DEFAULT 0,
        irrelevant_count INTEGER NOT NULL DEFAULT 0,
        harmful_count INTEGER NOT NULL DEFAULT 0,
        CHECK (
          (scope = 'global' AND project_key IS NULL) OR
          (scope = 'project' AND project_key IS NOT NULL)
        )
      );
      CREATE INDEX IF NOT EXISTS memories_lookup
        ON memories(status, scope, project_key, updated_at DESC);
      CREATE TABLE IF NOT EXISTS feedback (
        memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        project_key TEXT NOT NULL,
        result TEXT NOT NULL CHECK (result IN ('helpful', 'irrelevant', 'harmful')),
        created_at TEXT NOT NULL,
        PRIMARY KEY(memory_id, project_key)
      );
    `);
  }

  close(): void {
    this.#database.close();
  }

  propose(input: ProposeMemoryInput): { memory: DebugMemory; duplicate: boolean } {
    assertNoLikelySecret([
      input.symptom,
      input.rootCause,
      input.solution,
      input.evidence,
      ...Object.values(input.environment ?? {}),
    ]);
    const project = input.scope === "project"
      ? resolveProjectIdentity(input.projectPath ?? process.cwd())
      : undefined;
    const memoryFingerprint = fingerprint(input, project?.key);
    const existing = this.#database
      .prepare("SELECT * FROM memories WHERE fingerprint = ?")
      .get(memoryFingerprint) as unknown as MemoryRow | undefined;
    if (existing) {
      return { memory: mapRow(existing), duplicate: true };
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      this.#database.prepare(`
        INSERT INTO memories (
          id, scope, project_key, project_label, symptom, root_cause, solution,
          evidence, environment_json, status, fingerprint, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?)
      `).run(
        id,
        input.scope,
        project?.key ?? null,
        project?.label ?? null,
        input.symptom.trim(),
        input.rootCause.trim(),
        input.solution.trim(),
        input.evidence.trim(),
        JSON.stringify(input.environment ?? {}),
        memoryFingerprint,
        now,
        now,
      );
    } catch (error) {
      const concurrent = this.#database
        .prepare("SELECT * FROM memories WHERE fingerprint = ?")
        .get(memoryFingerprint) as unknown as MemoryRow | undefined;
      if (concurrent) return { memory: mapRow(concurrent), duplicate: true };
      throw error;
    }
    return { memory: this.get(id), duplicate: false };
  }

  confirm(id: string, verification: string): DebugMemory {
    assertNoLikelySecret([verification]);
    if (verification.trim().length < 8) {
      throw new Error("Verification evidence must describe a successful test, build, or observed result.");
    }
    const current = this.get(id);
    if (current.status === "verified") return current;
    if (current.status === "superseded") {
      throw new Error(`Memory ${id} was superseded and cannot be confirmed.`);
    }
    const now = new Date().toISOString();
    const result = this.#database.prepare(`
      UPDATE memories
      SET status = 'verified',
          evidence = evidence || '\nVerification: ' || ?,
          verified_at = COALESCE(verified_at, ?),
          updated_at = ?
      WHERE id = ? AND status = 'candidate'
    `).run(verification.trim(), now, now, id);
    if (result.changes === 0) {
      throw new Error(`No confirmable memory found with id ${id}.`);
    }
    return this.get(id);
  }

  search(input: SearchMemoryInput): MemoryMatch[] {
    const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
    const project = input.projectPath ? resolveProjectIdentity(input.projectPath) : undefined;
    const statuses = input.includeCandidates ? "('verified', 'candidate')" : "('verified')";
    const rows = this.#database.prepare(`
      SELECT * FROM memories
      WHERE status IN ${statuses}
        AND (scope = 'global' OR (scope = 'project' AND project_key = ?))
      ORDER BY updated_at DESC
      LIMIT 500
    `).all(project?.key ?? "") as unknown as MemoryRow[];

    const matches = rows
      .map(mapRow)
      .map((memory) => scoreMemory(memory, input.query, input.environment ?? {}))
      .filter((match): match is MemoryMatch => match !== undefined);

    const projectMatches = matches
      .filter((match) => match.memory.scope === "project")
      .sort((left, right) => right.score - left.score);
    const globalMatches = matches
      .filter((match) => match.memory.scope === "global")
      .sort((left, right) => right.score - left.score);
    return [...projectMatches, ...globalMatches].slice(0, limit);
  }

  feedback(id: string, projectPath: string, result: FeedbackResult): DebugMemory {
    const project = resolveProjectIdentity(projectPath);
    const now = new Date().toISOString();
    const previous = this.#database
      .prepare("SELECT result FROM feedback WHERE memory_id = ? AND project_key = ?")
      .get(id, project.key) as { result: FeedbackResult } | undefined;

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      if (previous) {
        this.#database.prepare(`
          UPDATE memories SET ${previous.result}_count = MAX(${previous.result}_count - 1, 0)
          WHERE id = ?
        `).run(id);
      }
      this.#database.prepare(`
        INSERT INTO feedback(memory_id, project_key, result, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(memory_id, project_key)
        DO UPDATE SET result = excluded.result, created_at = excluded.created_at
      `).run(id, project.key, result, now);
      const update = this.#database.prepare(`
        UPDATE memories SET ${result}_count = ${result}_count + 1, updated_at = ? WHERE id = ?
      `).run(now, id);
      if (update.changes === 0) {
        throw new Error(`No memory found with id ${id}.`);
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.get(id);
  }

  promote(id: string, reason: string): { memory: DebugMemory; duplicate: boolean } {
    const source = this.get(id);
    if (source.scope !== "project" || source.status !== "verified") {
      throw new Error("Only a verified project memory can be promoted to global scope.");
    }
    if (source.helpfulCount < 2) {
      throw new Error("Promotion requires helpful feedback from at least two distinct projects.");
    }
    return this.propose({
      scope: "global",
      symptom: source.symptom,
      rootCause: source.rootCause,
      solution: source.solution,
      evidence: `${source.evidence}\nPromotion reason: ${reason.trim()}`,
      environment: source.environment,
    });
  }

  get(id: string): DebugMemory {
    const row = this.#database.prepare("SELECT * FROM memories WHERE id = ?").get(id) as unknown as
      | MemoryRow
      | undefined;
    if (!row) {
      throw new Error(`No memory found with id ${id}.`);
    }
    return mapRow(row);
  }
}
