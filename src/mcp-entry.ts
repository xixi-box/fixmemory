#!/usr/bin/env node
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { MemoryStore } from "./core/store.js";
import { createFixMemoryServer } from "./mcp/server.js";

const dataDirectory = resolve(process.env.FIXMEMORY_DATA_DIR ?? join(homedir(), ".fixmemory", "data"));

serveStdio(
  () => {
    const store = new MemoryStore(join(dataDirectory, "memory.db"));
    const server = createFixMemoryServer(store);
    const closeServer = server.close.bind(server);
    server.close = async (): Promise<void> => {
      await closeServer();
      store.close();
    };
    return server;
  },
  {
    legacy: "serve",
    onerror: (error) => console.error(`FixMemory MCP error: ${error.message}`),
  },
);
