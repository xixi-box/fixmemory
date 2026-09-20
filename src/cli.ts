#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { detectAgents, type AgentId } from "./installer/adapters.js";
import {
  defaultInstallPaths,
  installFixMemory,
  probeMcpRuntime,
  uninstallFixMemory,
} from "./installer/install.js";

const usage = "Usage: fixmemory [setup [--yes] [--agents codex,zcode,local-agent] | doctor | uninstall [--delete-data]]";

function parseAgentIds(value: string): AgentId[] {
  const supported = new Set<AgentId>(["codex", "zcode", "local-agent"]);
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  for (const item of values) {
    if (!supported.has(item as AgentId)) throw new Error(`Unsupported agent '${item}'.`);
  }
  return values as AgentId[];
}

async function selectAgents(): Promise<AgentId[]> {
  const paths = defaultInstallPaths();
  const detected = detectAgents(paths.homeDirectory, paths.appDataDirectory).filter((agent) => agent.detected);
  if (detected.length === 0) {
    throw new Error("No supported Harness was detected. Install Codex, zCode, or Local Coding Agent first.");
  }
  console.log("Detected coding agents:\n");
  detected.forEach((agent, index) => console.log(`  ${index + 1}. ${agent.label}`));
  const prompt = createInterface({ input: stdin, output: stdout });
  const answer = await prompt.question("\nEnable which agents? Press Enter for all, or enter numbers separated by commas: ");
  prompt.close();
  if (!answer.trim()) return detected.map((agent) => agent.id);
  const indexes = answer.split(",").map((item) => Number.parseInt(item.trim(), 10) - 1);
  const selected = indexes.map((index) => detected[index]?.id).filter((id): id is AgentId => id !== undefined);
  if (selected.length === 0) throw new Error("No valid agent selection was provided.");
  return [...new Set(selected)];
}

async function runSetup(args: string[]): Promise<void> {
  const agentFlagIndex = args.indexOf("--agents");
  const yes = args.includes("--yes");
  const selected = agentFlagIndex >= 0
    ? parseAgentIds(args[agentFlagIndex + 1] ?? "")
    : yes
      ? detectAgents(defaultInstallPaths().homeDirectory, defaultInstallPaths().appDataDirectory)
          .filter((agent) => agent.detected)
          .map((agent) => agent.id)
      : await selectAgents();
  if (selected.length === 0) throw new Error("No supported Harness was selected or detected.");
  const result = await installFixMemory(selected);
  console.log(`\nFixMemory installed for: ${result.configuredAgents.join(", ")}`);
  console.log(`Shared skill: ${result.skillPath}`);
  console.log(`MCP tools verified: ${result.toolNames.join(", ")}`);
  console.log("Restart active agent sessions to load FixMemory.");
}

async function runDoctor(): Promise<void> {
  const paths = defaultInstallPaths();
  const manifestPath = join(paths.installRoot, "install.json");
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { runtimePath: string };
  const tools = await probeMcpRuntime(process.execPath, manifest.runtimePath, join(paths.installRoot, "data"));
  console.log(`ok runtime (${tools.length} tools): ${tools.join(", ")}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "setup";
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(usage);
    return;
  }
  if (command === "--version" || command === "-v") {
    console.log("0.1.0");
    return;
  }
  if (command === "setup") {
    await runSetup(args.slice(1));
    return;
  }
  if (command === "doctor") {
    await runDoctor();
    return;
  }
  if (command === "uninstall") {
    const removed = uninstallFixMemory(args.includes("--delete-data"));
    console.log(removed.length > 0 ? `Removed FixMemory from: ${removed.join(", ")}` : "FixMemory is not installed.");
    return;
  }
  throw new Error(usage);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `FixMemory: ${error.message}` : String(error));
  process.exitCode = 1;
});
