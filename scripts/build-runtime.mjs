import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const runtimeDirectory = resolve(root, "runtime");
const output = resolve(runtimeDirectory, "fixmemory-mcp.mjs");

await rm(runtimeDirectory, { recursive: true, force: true });
await mkdir(runtimeDirectory, { recursive: true });
await build({
  entryPoints: [resolve(root, "src", "mcp-entry.ts")],
  outfile: output,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: false,
});
await chmod(output, 0o755);
