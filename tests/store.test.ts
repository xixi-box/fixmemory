import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
