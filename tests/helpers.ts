import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function createGitProject(path: string, remote?: string): void {
  mkdirSync(join(path, ".git"), { recursive: true });
  const remoteSection = remote
    ? `\n[remote "origin"]\n\turl = ${remote}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`
    : "";
  writeFileSync(join(path, ".git", "config"), `[core]\n\trepositoryformatversion = 0\n${remoteSection}`, "utf8");
}
