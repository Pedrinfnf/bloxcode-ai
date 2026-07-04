// ═══════════════════════════════════════════════════════════════════════════════
// MCP CLIENT — Model Context Protocol (inspired by Claude Code + OpenCode MCP)
// Connects to MCP servers for extended tool capabilities
// ═══════════════════════════════════════════════════════════════════════════════

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { _, S } from "../core/ansi.js";
import { MCP_CONFIG_FILE, WORKSPACE } from "../config/state.js";
import { drawTable } from "../tui/box.js";

let mcpServers = {};
let mcpProcs = {};

export async function loadMcpConfig() {
  try {
    mcpServers = JSON.parse(await fs.readFile(MCP_CONFIG_FILE, "utf8"));
  } catch {
    mcpServers = {};
  }
  return mcpServers;
}

export async function saveMcpConfig() {
  await fs.writeFile(MCP_CONFIG_FILE, JSON.stringify(mcpServers, null, 2), "utf8").catch(() => {});
}

export function getMcpServers() {
  return mcpServers;
}

/**
 * Add an MCP server (like: claude mcp add notion https://mcp.notion.com)
 */
export async function addMcpServer(name, config) {
  mcpServers[name] = config;
  await saveMcpConfig();
  console.log(S(`\n✅ MCP server '${name}' adicionado.\n`, _.Gr));
}

/**
 * Remove an MCP server
 */
export async function removeMcpServer(name) {
  if (mcpProcs[name]) {
    try { mcpProcs[name].kill(); } catch {}
    delete mcpProcs[name];
  }
  delete mcpServers[name];
  await saveMcpConfig();
  console.log(S(`\n✅ MCP server '${name}' removido.\n`, _.Gr));
}

/**
 * Call a tool on an MCP server (JSON-RPC)
 */
export async function toolMcp({ server, tool: toolName, args = {} } = {}) {
  if (!mcpServers[server]) {
    return { ok: false, error: `MCP '${server}' não configurado. Crie .bloxcode/mcp.json` };
  }

  // Start server process if not running
  if (!mcpProcs[server]) {
    const cfg = mcpServers[server];
    try {
      const proc = spawn(cfg.command, cfg.args || [], {
        cwd: WORKSPACE,
        env: { ...process.env, ...(cfg.env || {}) },
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Initialize
      proc.stdin.write(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "BloxCode", version: "4.0" },
        },
      }) + "\n");

      mcpProcs[server] = proc;

      // Handle exit
      proc.on("exit", () => { delete mcpProcs[server]; });
    } catch (err) {
      return { ok: false, error: `Falha ao iniciar MCP '${server}': ${err.message}` };
    }
  }

  // Call tool
  return new Promise((resolve) => {
    let resp = "";
    const timeout = setTimeout(() => resolve({ ok: false, error: "MCP timeout (30s)" }), 30000);

    const onData = (chunk) => {
      resp += chunk.toString();
      try {
        const parsed = JSON.parse(resp.trim().split("\n").pop());
        clearTimeout(timeout);
        mcpProcs[server].stdout.removeListener("data", onData);
        resolve({ ok: true, result: parsed.result || parsed });
      } catch {}
    };

    mcpProcs[server].stdout.on("data", onData);
    mcpProcs[server].stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }) + "\n");
  });
}

/**
 * List MCP tools from a server
 */
export async function listMcpTools(server) {
  if (!mcpProcs[server]) {
    return { ok: false, error: `MCP '${server}' não iniciado` };
  }

  return new Promise((resolve) => {
    let resp = "";
    const timeout = setTimeout(() => resolve({ ok: false, error: "MCP timeout" }), 10000);

    const onData = (chunk) => {
      resp += chunk.toString();
      try {
        const parsed = JSON.parse(resp.trim().split("\n").pop());
        clearTimeout(timeout);
        mcpProcs[server].stdout.removeListener("data", onData);
        resolve({ ok: true, tools: parsed.result?.tools || [] });
      } catch {}
    };

    mcpProcs[server].stdout.on("data", onData);
    mcpProcs[server].stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/list",
      params: {},
    }) + "\n");
  });
}

/**
 * Print MCP status
 */
export function printMcpStatus() {
  const servers = Object.entries(mcpServers);
  if (!servers.length) {
    console.log(S("\nNenhum MCP server configurado.", _.G));
    console.log(S("  Crie .bloxcode/mcp.json ou use /mcp add <name> <command>\n", _.d));
    return;
  }

  const rows = servers.map(([name, cfg]) => [
    name,
    `${S(cfg.command, _.c)} ${mcpProcs[name] ? S("● RUNNING", _.Gr) : S("○ STOPPED", _.G)}`,
  ]);
  console.log(drawTable(rows, { title: "🔌 MCP SERVERS", color: _.c, w: 76 }));
}

/**
 * Cleanup all MCP processes
 */
export function cleanupMcp() {
  for (const [name, proc] of Object.entries(mcpProcs)) {
    try { proc.kill(); } catch {}
  }
  mcpProcs = {};
}
