import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { ProjectIdentity } from "./types.js";

function findProjectRoot(startPath: string): string {
  let current = resolve(startPath);
  if (existsSync(current) && !statSync(current).isDirectory()) {
    current = dirname(current);
  }

  while (true) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(startPath);
    }
    current = parent;
  }
}

function readOrigin(root: string): string | undefined {
  const dotGit = join(root, ".git");
  if (!existsSync(dotGit)) {
    return undefined;
  }
  let gitDirectory = dotGit;
  if (!statSync(dotGit).isDirectory()) {
    const pointer = readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/im)?.[1]?.trim();
    if (!pointer) return undefined;
    gitDirectory = resolve(dirname(dotGit), pointer);
  }
  const commonDirectoryPointer = join(gitDirectory, "commondir");
  const configDirectory = existsSync(commonDirectoryPointer)
    ? resolve(gitDirectory, readFileSync(commonDirectoryPointer, "utf8").trim())
    : gitDirectory;
  const configPath = join(configDirectory, "config");
  if (!existsSync(configPath)) return undefined;
  const config = readFileSync(configPath, "utf8");
  const originSection = config.match(/\[remote\s+"origin"\]([\s\S]*?)(?=\n\[|$)/i)?.[1];
  const rawUrl = originSection?.match(/^\s*url\s*=\s*(.+)$/im)?.[1]?.trim();
  if (!rawUrl) {
    return undefined;
  }
  return rawUrl.replace(/:\/\/[^/@\s]+@/, "://").replace(/\.git$/i, "").toLowerCase();
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function resolveProjectIdentity(projectPath: string): ProjectIdentity {
  const root = findProjectRoot(projectPath);
  const canonicalRoot = existsSync(root) ? realpathSync.native(root) : root;
  const origin = readOrigin(canonicalRoot);
  const identitySource = origin ?? canonicalRoot.replaceAll("\\", "/").toLowerCase();
  return {
    key: stableHash(identitySource),
    label: basename(canonicalRoot),
    root: canonicalRoot,
  };
}
