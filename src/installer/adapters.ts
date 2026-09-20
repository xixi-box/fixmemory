import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type AgentId = "codex" | "zcode" | "local-agent";

export interface AgentTarget {
  id: AgentId;
  label: string;
  configPath: string;
  detected: boolean;
}

export interface AdapterContext {
  homeDirectory: string;
  appDataDirectory: string;
  nodeExecutable: string;
  runtimePath: string;
  dataDirectory: string;
  backupFile: (path: string) => void;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonObject;
}

function readJsonObject(path: string): JsonObject {
  if (!existsSync(path)) {
    return {};
  }
  return asObject(JSON.parse(readFileSync(path, "utf8")) as unknown, path);
}

function writeJson(path: string, value: JsonObject, backupFile: (path: string) => void): void {
  if (existsSync(path)) {
    backupFile(path);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function serverConfig(context: AdapterContext): JsonObject {
  return {
    command: context.nodeExecutable,
    args: [context.runtimePath],
    env: { FIXMEMORY_DATA_DIR: context.dataDirectory },
  };
}

export function detectAgents(homeDirectory: string, appDataDirectory: string): AgentTarget[] {
  const targets: AgentTarget[] = [
    {
      id: "codex",
      label: "Codex",
      configPath: join(homeDirectory, ".codex", "config.toml"),
      detected: existsSync(join(homeDirectory, ".codex")),
    },
    {
      id: "zcode",
      label: "zCode",
      configPath: join(homeDirectory, ".zcode", "cli", "config.json"),
      detected: existsSync(join(homeDirectory, ".zcode")),
    },
    {
      id: "local-agent",
      label: "Local Coding Agent",
      configPath: join(appDataDirectory, "local-coding-agent", "config.json"),
      detected: existsSync(join(appDataDirectory, "local-coding-agent")),
    },
  ];
  return targets;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

const CODEX_START = "# fixmemory:begin";
const CODEX_END = "# fixmemory:end";

function removeCodexBlock(content: string): string {
  const start = content.indexOf(CODEX_START);
  const end = content.indexOf(CODEX_END);
  if (start === -1 && end === -1) {
    return content;
  }
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Codex config contains an incomplete FixMemory managed block; repair it manually before continuing.");
  }
  return `${content.slice(0, start).trimEnd()}\n${content.slice(end + CODEX_END.length).trimStart()}`;
}

function configureCodex(target: AgentTarget, context: AdapterContext): void {
  const original = existsSync(target.configPath) ? readFileSync(target.configPath, "utf8") : "";
  if (/^\s*\[mcp_servers\.fixmemory\]\s*$/m.test(removeCodexBlock(original))) {
    throw new Error("Codex already has an unmanaged mcp_servers.fixmemory entry.");
  }
  const clean = removeCodexBlock(original).trimEnd();
  const block = [
    CODEX_START,
    "[mcp_servers.fixmemory]",
    `command = ${tomlString(context.nodeExecutable)}`,
    `args = [${tomlString(context.runtimePath)}]`,
    "",
    "[mcp_servers.fixmemory.env]",
    `FIXMEMORY_DATA_DIR = ${tomlString(context.dataDirectory)}`,
    CODEX_END,
  ].join("\n");
  if (existsSync(target.configPath)) {
    context.backupFile(target.configPath);
  }
  mkdirSync(dirname(target.configPath), { recursive: true });
  writeFileSync(target.configPath, `${clean}${clean ? "\n\n" : ""}${block}\n`, "utf8");
}

function configureZcode(target: AgentTarget, context: AdapterContext): void {
  const config = readJsonObject(target.configPath);
  const mcp = asObject(config.mcp ?? {}, "zCode mcp");
  const servers = asObject(mcp.servers ?? {}, "zCode mcp.servers");
  servers.fixmemory = { type: "stdio", ...serverConfig(context), enabled: true };
  mcp.servers = servers;
  config.mcp = mcp;
  writeJson(target.configPath, config, context.backupFile);
}

function configureLocalAgent(target: AgentTarget, context: AdapterContext): void {
  const config = readJsonObject(target.configPath);
  const servers = asObject(config.mcpServers ?? {}, "Local Agent mcpServers");
  servers.fixmemory = serverConfig(context);
  config.mcpServers = servers;
  writeJson(target.configPath, config, context.backupFile);
}

export function configureAgent(target: AgentTarget, context: AdapterContext): void {
  if (target.id === "codex") configureCodex(target, context);
  if (target.id === "zcode") configureZcode(target, context);
  if (target.id === "local-agent") configureLocalAgent(target, context);
}

function removeJsonServer(target: AgentTarget, context: AdapterContext): void {
  if (!existsSync(target.configPath)) return;
  const config = readJsonObject(target.configPath);
  if (target.id === "zcode") {
    const mcp = asObject(config.mcp ?? {}, "zCode mcp");
    const servers = asObject(mcp.servers ?? {}, "zCode mcp.servers");
    delete servers.fixmemory;
    mcp.servers = servers;
    config.mcp = mcp;
  } else {
    const servers = asObject(config.mcpServers ?? {}, "Local Agent mcpServers");
    delete servers.fixmemory;
    config.mcpServers = servers;
  }
  writeJson(target.configPath, config, context.backupFile);
}

export function removeAgent(target: AgentTarget, context: AdapterContext): void {
  if (!existsSync(target.configPath)) return;
  if (target.id === "codex") {
    const original = readFileSync(target.configPath, "utf8");
    const clean = removeCodexBlock(original);
    if (clean !== original) {
      context.backupFile(target.configPath);
      writeFileSync(target.configPath, clean, "utf8");
    }
    return;
  }
  removeJsonServer(target, context);
}
