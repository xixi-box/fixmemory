import { spawn } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configureAgent, detectAgents, removeAgent, type AdapterContext, type AgentId } from "./adapters.js";

export interface InstallPaths {
  homeDirectory: string;
  appDataDirectory: string;
  installRoot: string;
  packageRoot: string;
}

export interface InstallResult {
  runtimePath: string;
  skillPath: string;
  configuredAgents: AgentId[];
  toolNames: string[];
}

interface InstallManifest {
  version: 1;
  runtimePath: string;
  skillPath: string;
  configuredAgents: AgentId[];
  installedAt: string;
}

function defaultPackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function defaultInstallPaths(): InstallPaths {
  const homeDirectory = homedir();
  return {
    homeDirectory,
    appDataDirectory: process.env.APPDATA ?? join(homeDirectory, "AppData", "Roaming"),
    installRoot: join(homeDirectory, ".fixmemory"),
    packageRoot: defaultPackageRoot(),
  };
}

function copyRuntimeAndSkill(paths: InstallPaths): { runtimePath: string; skillPath: string } {
  const runtimeSource = join(paths.packageRoot, "runtime", "fixmemory-mcp.mjs");
  const runtimeMapSource = `${runtimeSource}.map`;
  const skillSource = join(paths.packageRoot, "skill", "fixmemory");
  if (!existsSync(runtimeSource) || !existsSync(skillSource)) {
    throw new Error("FixMemory package is incomplete. Run or install a built package containing runtime/ and skill/.");
  }

  const runtimeDirectory = join(paths.installRoot, "runtime");
  const runtimePath = join(runtimeDirectory, "fixmemory-mcp.mjs");
  const skillPath = join(paths.homeDirectory, ".agents", "skills", "fixmemory");
  const manifestPath = join(paths.installRoot, "install.json");

  if (existsSync(skillPath) && !existsSync(manifestPath)) {
    throw new Error(`A FixMemory skill already exists at ${skillPath} but is not managed by this installer.`);
  }

  mkdirSync(runtimeDirectory, { recursive: true });
  copyFileSync(runtimeSource, runtimePath);
  if (existsSync(runtimeMapSource)) copyFileSync(runtimeMapSource, `${runtimePath}.map`);
  if (existsSync(skillPath)) rmSync(skillPath, { recursive: true, force: true });
  mkdirSync(dirname(skillPath), { recursive: true });
  cpSync(skillSource, skillPath, { recursive: true });
  return { runtimePath, skillPath };
}

function createBackupFunction(paths: InstallPaths): (path: string) => void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDirectory = join(paths.installRoot, "backups", stamp);
  const copied = new Set<string>();
  return (path: string): void => {
    const resolved = resolve(path);
    if (copied.has(resolved) || !existsSync(resolved)) return;
    mkdirSync(backupDirectory, { recursive: true });
    copyFileSync(resolved, join(backupDirectory, `${basename(resolved)}-${copied.size}.bak`));
    copied.add(resolved);
  };
}

export async function probeMcpRuntime(nodeExecutable: string, runtimePath: string, dataDirectory: string): Promise<string[]> {
  return await new Promise<string[]>((resolvePromise, rejectPromise) => {
    const child = spawn(nodeExecutable, [runtimePath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, FIXMEMORY_DATA_DIR: dataDirectory },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error(`MCP probe timed out. ${stderr}`.trim()));
    }, 10_000);

    const send = (message: Record<string, unknown>): void => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line) as { id?: number; result?: { tools?: Array<{ name: string }> }; error?: unknown };
        if (message.id === 1 && message.result) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        }
        if (message.id === 2) {
          clearTimeout(timer);
          child.kill();
          if (message.error || !message.result?.tools) {
            rejectPromise(new Error(`MCP tools/list failed: ${JSON.stringify(message.error)}`));
          } else {
            resolvePromise(message.result.tools.map((tool) => tool.name));
          }
        }
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        rejectPromise(new Error(`MCP runtime exited with code ${code}. ${stderr}`.trim()));
      }
    });
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "fixmemory-doctor", version: "0.1.0" },
      },
    });
  });
}

function adapterContext(paths: InstallPaths, runtimePath: string): AdapterContext {
  return {
    homeDirectory: paths.homeDirectory,
    appDataDirectory: paths.appDataDirectory,
    nodeExecutable: process.execPath,
    runtimePath,
    dataDirectory: join(paths.installRoot, "data"),
    backupFile: createBackupFunction(paths),
  };
}

export async function installFixMemory(selectedAgents: AgentId[], paths = defaultInstallPaths()): Promise<InstallResult> {
  mkdirSync(paths.installRoot, { recursive: true });
  const manifestPath = join(paths.installRoot, "install.json");
  const previous = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8")) as InstallManifest
    : undefined;
  const configuredAgents = [...new Set([...(previous?.configuredAgents ?? []), ...selectedAgents])];
  const { runtimePath, skillPath } = copyRuntimeAndSkill(paths);
  const context = adapterContext(paths, runtimePath);
  const toolNames = await probeMcpRuntime(context.nodeExecutable, runtimePath, context.dataDirectory);
  const targets = detectAgents(paths.homeDirectory, paths.appDataDirectory);
  for (const agentId of selectedAgents) {
    const target = targets.find((candidate) => candidate.id === agentId);
    if (!target) throw new Error(`Unsupported agent: ${agentId}`);
    configureAgent(target, context);
  }
  const manifest: InstallManifest = {
    version: 1,
    runtimePath,
    skillPath,
    configuredAgents,
    installedAt: new Date().toISOString(),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { runtimePath, skillPath, configuredAgents, toolNames };
}

export function uninstallFixMemory(deleteData: boolean, paths = defaultInstallPaths()): AgentId[] {
  const manifestPath = join(paths.installRoot, "install.json");
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as InstallManifest;
  const context = adapterContext(paths, manifest.runtimePath);
  const targets = detectAgents(paths.homeDirectory, paths.appDataDirectory);
  for (const agentId of manifest.configuredAgents) {
    const target = targets.find((candidate) => candidate.id === agentId);
    if (target) removeAgent(target, context);
  }
  rmSync(manifest.skillPath, { recursive: true, force: true });
  rmSync(join(paths.installRoot, "runtime"), { recursive: true, force: true });
  rmSync(manifestPath, { force: true });
  if (deleteData) rmSync(join(paths.installRoot, "data"), { recursive: true, force: true });
  return manifest.configuredAgents;
}
