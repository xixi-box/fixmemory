import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { MemoryStore } from "../src/core/store.js";
import { resolveProjectIdentity } from "../src/core/project.js";
import { createGitProject } from "./helpers.js";

test("candidate memories stay hidden until verified and remain project scoped", () => {
  const root = mkdtempSync(join(tmpdir(), "fixmemory-store-"));
  const projectA = join(root, "project-a");
  const projectB = join(root, "project-b");
  createGitProject(projectA, "https://example.com/team/project-a.git");
  createGitProject(projectB, "https://example.com/team/project-b.git");
  const store = new MemoryStore(join(root, "memory.db"));
  try {
    const proposal = store.propose({
      scope: "project",
      projectPath: projectA,
      symptom: "ERR_MODULE_NOT_FOUND when starting the agent",
      rootCause: "The compiled entry path pointed at dist/src instead of dist",
      solution: "Set TypeScript rootDir to src and rebuild the package",
      evidence: "The emitted path was inspected before rebuilding",
      environment: { node: "24", os: "windows" },
    });
    assert.equal(proposal.memory.status, "candidate");
    assert.equal(store.search({ query: "ERR_MODULE_NOT_FOUND dist entry", projectPath: projectA }).length, 0);

    const verified = store.confirm(proposal.memory.id, "npm run build succeeded and node dist/cli.js started");
    assert.equal(verified.status, "verified");
    const confirmedAgain = store.confirm(proposal.memory.id, "This second confirmation must not append duplicate evidence");
    assert.equal(confirmedAgain.evidence, verified.evidence);
    assert.equal(store.search({ query: "ERR_MODULE_NOT_FOUND dist entry", projectPath: projectA }).length, 1);
    assert.equal(store.search({ query: "ERR_MODULE_NOT_FOUND dist entry", projectPath: projectB }).length, 0);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("feedback is unique per project and gates global promotion", () => {
  const root = mkdtempSync(join(tmpdir(), "fixmemory-promote-"));
  const projects = ["a", "b", "c"].map((name) => join(root, name));
  projects.forEach((path, index) => createGitProject(path, `https://example.com/team/project-${index}.git`));
  const store = new MemoryStore(join(root, "memory.db"));
  try {
    const source = store.propose({
      scope: "project",
      projectPath: projects[0],
      symptom: "spawn ENOENT on Windows",
      rootCause: "A shell shim was passed directly to spawn",
      solution: "Resolve the executable or use cmd /c for the shim",
      evidence: "Reproduced with the shim path",
    }).memory;
    store.confirm(source.id, "The child process test passed on Windows after the change");
    assert.throws(() => store.promote(source.id, "Used outside the original repository"), /at least two/);
    store.feedback(source.id, projects[0]!, "helpful");
    store.feedback(source.id, projects[0]!, "helpful");
    assert.equal(store.get(source.id).helpfulCount, 1);
    store.feedback(source.id, projects[1]!, "helpful");
    const promoted = store.promote(source.id, "The same Windows spawn failure and fix were verified in two repositories");
    store.confirm(promoted.memory.id, "Cross-project reproduction passed in both independent repositories");
    const matches = store.search({ query: "Windows spawn ENOENT shell shim", projectPath: projects[2] });
    assert.equal(matches[0]?.memory.scope, "global");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("likely credentials are rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "fixmemory-secret-"));
  const store = new MemoryStore(join(root, "memory.db"));
  try {
    assert.throws(() => store.propose({
      scope: "global",
      symptom: "API request failed",
      rootCause: "Expired credential",
      solution: "Replace api_key=sk-abcdefghijklmnopqrstuvwxyz123456",
      evidence: "Request worked afterwards",
    }), /refused to store/);
    assert.throws(() => store.propose({
      scope: "global",
      symptom: "Request failed in production",
      rootCause: "Environment differs",
      solution: "Compare sanitized environment values",
      evidence: "Reproduced locally",
      environment: { token: "Bearer abcdefghijklmnopqrstuvwxyz123456" },
    }), /refused to store/);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("git worktrees share the repository identity", () => {
  const root = mkdtempSync(join(tmpdir(), "fixmemory-worktree-"));
  const main = join(root, "main");
  const worktree = join(root, "feature");
  const worktreeGitDirectory = join(main, ".git", "worktrees", "feature");
  try {
    mkdirSync(worktreeGitDirectory, { recursive: true });
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(main, ".git", "config"), '[remote "origin"]\n  url = https://example.com/team/shared.git\n');
    writeFileSync(join(worktree, ".git"), `gitdir: ${worktreeGitDirectory}\n`);
    writeFileSync(join(worktreeGitDirectory, "commondir"), "../..\n");
    assert.equal(resolveProjectIdentity(main).key, resolveProjectIdentity(worktree).key);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("memories can be listed, superseded, and safely deleted", () => {
  const root = mkdtempSync(join(tmpdir(), "fixmemory-governance-"));
  const project = join(root, "project");
  createGitProject(project, "https://example.com/team/governance.git");
  const store = new MemoryStore(join(root, "memory.db"));
  try {
    const original = store.propose({
      scope: "project",
      projectPath: project,
      symptom: "Build uses an outdated generated client",
      rootCause: "The generated client was not refreshed after the schema changed",
      solution: "Regenerate the client before compiling",
      evidence: "The stale generated file reproduced the type error",
    }).memory;
    store.confirm(original.id, "Generation followed by the focused build completed successfully");
    assert.equal(store.list({ projectPath: project }).total, 1);
    assert.throws(() => store.delete(original.id), /Supersede it first/);

    const replacement = store.propose({
      scope: "project",
      projectPath: project,
      symptom: "Build uses an outdated generated client after schema changes",
      rootCause: "The checked-in generator was replaced by build-time generation",
      solution: "Run the standard build, which now generates the client automatically",
      evidence: "The new build path generated the client before type checking",
    }).memory;
    store.confirm(replacement.id, "The standard build regenerated the client and completed successfully");
    const superseded = store.supersede(
      original.id,
      "The generator was removed and this procedure is no longer valid",
      replacement.id,
    );
    assert.equal(superseded.status, "superseded");
    assert.equal(superseded.replacementId, replacement.id);
    const matches = store.search({ query: "outdated generated client", projectPath: project });
    assert.equal(matches.some((match) => match.memory.id === original.id), false);
    assert.equal(matches.some((match) => match.memory.id === replacement.id), true);
    assert.equal(store.list({ projectPath: project, status: "superseded" }).items[0]?.id, original.id);
    assert.equal(store.delete(original.id).id, original.id);
    assert.throws(() => store.get(original.id), /No memory found/);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("existing 0.1 databases gain governance columns without data loss", () => {
  const root = mkdtempSync(join(tmpdir(), "fixmemory-migration-"));
  const databasePath = join(root, "memory.db");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, project_key TEXT, project_label TEXT,
      symptom TEXT NOT NULL, root_cause TEXT NOT NULL, solution TEXT NOT NULL,
      evidence TEXT NOT NULL, environment_json TEXT NOT NULL, status TEXT NOT NULL,
      fingerprint TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, verified_at TEXT,
      updated_at TEXT NOT NULL, helpful_count INTEGER NOT NULL DEFAULT 0,
      irrelevant_count INTEGER NOT NULL DEFAULT 0, harmful_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE feedback (
      memory_id TEXT NOT NULL, project_key TEXT NOT NULL, result TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(memory_id, project_key)
    );
  `);
  legacy.close();
  const store = new MemoryStore(databasePath);
  try {
    const columns = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const names = (columns.prepare("PRAGMA table_info(memories)").all() as Array<{ name: string }>).map((row) => row.name);
      assert.ok(names.includes("superseded_reason"));
      assert.ok(names.includes("replacement_id"));
    } finally {
      columns.close();
    }
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
