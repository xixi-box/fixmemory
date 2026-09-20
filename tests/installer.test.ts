import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { installFixMemory, uninstallFixMemory, type InstallPaths } from "../src/installer/install.js";

test("setup configures detected Harness formats without replacing unrelated settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "fixmemory-install-"));
  const home = join(root, "home");
  const appData = join(root, "appdata");
  mkdirSync(join(home, ".codex"), { recursive: true });
  mkdirSync(join(home, ".zcode", "cli"), { recursive: true });
  mkdirSync(join(appData, "local-coding-agent"), { recursive: true });
  writeFileSync(join(home, ".codex", "config.toml"), "model = \"example\"\n", "utf8");
  writeFileSync(join(home, ".zcode", "cli", "config.json"), '{"plugins":{"enabled":true}}\n', "utf8");
  writeFileSync(join(appData, "local-coding-agent", "config.json"), '{"providers":{"keep":{}}}\n', "utf8");
  const paths: InstallPaths = {
    homeDirectory: home,
    appDataDirectory: appData,
    installRoot: join(home, ".fixmemory"),
    packageRoot: resolve("."),
  };
  try {
    await installFixMemory(["local-agent"], paths);
    const result = await installFixMemory(["codex", "zcode"], paths);
    assert.deepEqual(result.configuredAgents, ["local-agent", "codex", "zcode"]);
    assert.deepEqual(result.toolNames.sort(), [
      "fixmemory_confirm",
      "fixmemory_delete",
      "fixmemory_feedback",
      "fixmemory_get",
      "fixmemory_list",
      "fixmemory_promote",
      "fixmemory_propose",
      "fixmemory_search",
      "fixmemory_supersede",
    ]);
    assert.ok(existsSync(result.runtimePath));
    assert.ok(existsSync(join(result.skillPath, "SKILL.md")));

    const codex = readFileSync(join(home, ".codex", "config.toml"), "utf8");
    assert.match(codex, /model = "example"/);
    assert.match(codex, /\[mcp_servers\.fixmemory\]/);
    assert.equal(codex.match(/\[mcp_servers\.fixmemory\]/g)?.length, 1);
    const zcode = JSON.parse(readFileSync(join(home, ".zcode", "cli", "config.json"), "utf8")) as {
      plugins: unknown;
      mcp: { servers: { fixmemory: { type: string } } };
    };
    assert.ok(zcode.plugins);
    assert.equal(zcode.mcp.servers.fixmemory.type, "stdio");
    const localAgent = JSON.parse(readFileSync(join(appData, "local-coding-agent", "config.json"), "utf8")) as {
      providers: unknown;
      mcpServers: { fixmemory: { command: string } };
    };
    assert.ok(localAgent.providers);
    assert.equal(localAgent.mcpServers.fixmemory.command, process.execPath);

    mkdirSync(join(paths.installRoot, "data"), { recursive: true });
    writeFileSync(join(paths.installRoot, "data", "keep.txt"), "memory", "utf8");
    const removed = uninstallFixMemory(false, paths);
    assert.deepEqual(removed, ["local-agent", "codex", "zcode"]);
    assert.ok(existsSync(join(paths.installRoot, "data", "keep.txt")));
    assert.doesNotMatch(readFileSync(join(home, ".codex", "config.toml"), "utf8"), /fixmemory/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
