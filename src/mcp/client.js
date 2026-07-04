// ═══════════════════════════════════════════════════════════════════════════════
// MCP CLIENT — v0.0.11 — Real MCP that registers tools in the tool registry
// When you /mcp add a server, its tools become available to the LLM
// ═══════════════════════════════════════════════════════════════════════════════

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { _, S } from "../core/ansi.js";
import { MCP_CONFIG_FILE, WORKSPACE } from "../config/state.js";
import { registerTool, unregisterTool } from "../tools/registry.js";

let mcpServers = {};
let mcpProcs = {};
let mcpTools = {}; // server -> [tool names]

export async function loadMcpConfig() {
  try { mcpServers = JSON.parse(await fs.readFile(MCP_CONFIG_FILE, "utf8")); }
  catch { mcpServers = {}; }
  return mcpServers;
}

export async function saveMcpConfig() {
  await fs.writeFile(MCP_CONFIG_FILE, JSON.stringify(mcpServers, null, 2), "utf8").catch(() => {});
}

/**
 * Send JSON-RPC message and wait for response
 */
function rpcCall(proc, method, params = {}, timeout = 15000) {
  return new Promise((resolve, reject) => {
    let resp = "";
    const timer = setTimeout(() => { cleanup(); reject(new Error("MCP timeout")); }, timeout);
    const onData = (chunk) => {
      resp += chunk.toString();
      // Try parsing each line (JSON-RPC sends one JSON per line)
      const lines = resp.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line.trim());
          if (parsed.id || parsed.result || parsed.error) {
            cleanup();
            if (parsed.error) reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            else resolve(parsed.result || parsed);
            return;
          }
        } catch {}
      }
    };
    const cleanup = () => { clearTimeout(timer); proc.stdout.removeListener("data", onData); };
    proc.stdout.on("data", onData);
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) + "\n");
  });
}

/**
 * Start an MCP server, initialize it, discover its tools, and register them
 */
export async function startMcpServer(name) {
  const cfg = mcpServers[name];
  if (!cfg) return { ok: false, error: `MCP '${name}' not configured` };
  if (mcpProcs[name]) return { ok: true, message: "Already running" };

  try {
    console.log(S(`  ● starting ${name}...`, _.d));
    const proc = spawn(cfg.command, cfg.args || [], {
      cwd: WORKSPACE,
      env: { ...process.env, ...(cfg.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.on("error", (err) => { console.log(S(`  ✗ ${name}: ${err.message}`, _.r)); });
    proc.on("exit", () => {
      // Unregister tools when server dies
      for (const toolName of (mcpTools[name] || [])) unregisterTool(toolName);
      delete mcpProcs[name];
      delete mcpTools[name];
    });

    mcpProcs[name] = proc;

    // Initialize
    await rpcCall(proc, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "BloxCode", version: "0.0.11" },
    });

    // Discover tools
    const toolsResult = await rpcCall(proc, "tools/list", {});
    const tools = toolsResult?.tools || [];
    mcpTools[name] = [];

    for (const tool of tools) {
      const toolId = `${name}:${tool.name}`;
      const argNames = tool.inputSchema?.properties ? Object.keys(tool.inputSchema.properties) : [];

      // Register as a real callable tool in the registry
      registerTool(toolId, async (args) => {
        return await callMcpTool(name, tool.name, args);
      }, `[MCP:${name}] ${tool.description || tool.name}`, argNames, "mcp");

      mcpTools[name].push(toolId);
    }

    console.log(S(`  ✓ ${name}: ${tools.length} tools registered`, _.Gr));
    if (tools.length) {
      for (const t of tools.slice(0, 10)) {
        console.log(S(`    · ${t.name}`, _.c) + S(` — ${(t.description || "").slice(0, 50)}`, _.G));
      }
      if (tools.length > 10) console.log(S(`    · ... +${tools.length - 10} more`, _.d));
    }

    return { ok: true, tools: tools.length };
  } catch (err) {
    if (mcpProcs[name]) { try { mcpProcs[name].kill(); } catch {} }
    delete mcpProcs[name];
    console.log(S(`  ✗ ${name}: ${err.message}`, _.r));
    return { ok: false, error: err.message };
  }
}

/**
 * Call a tool on a running MCP server
 */
async function callMcpTool(serverName, toolName, args = {}) {
  const proc = mcpProcs[serverName];
  if (!proc) return { ok: false, error: `MCP '${serverName}' not running` };
  try {
    const result = await rpcCall(proc, "tools/call", { name: toolName, arguments: args }, 30000);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * /mcp add <name> <command> [args...] — add and start an MCP server
 */
export async function addMcpServer(name, command, args = [], env = {}) {
  mcpServers[name] = { command, args, env };
  await saveMcpConfig();
  return await startMcpServer(name);
}

/**
 * /mcp remove <name> — stop and remove an MCP server
 */
export async function removeMcpServer(name) {
  // Unregister tools
  for (const toolName of (mcpTools[name] || [])) unregisterTool(toolName);
  // Kill process
  if (mcpProcs[name]) { try { mcpProcs[name].kill(); } catch {} }
  delete mcpProcs[name];
  delete mcpTools[name];
  delete mcpServers[name];
  await saveMcpConfig();
  console.log(S(`  ✓ ${name} removed`, _.Gr));
}

/**
 * Start all configured MCP servers
 */
export async function startAllMcpServers() {
  const names = Object.keys(mcpServers);
  if (!names.length) return;
  console.log(S("  mcp servers", _.w, _.b));
  for (const name of names) {
    await startMcpServer(name);
  }
  console.log("");
}

/**
 * /mcp status — show all servers and their tools
 */
export function printMcpStatus() {
  const servers = Object.entries(mcpServers);
  if (!servers.length) {
    console.log(S("\n  no MCP servers configured", _.G));
    console.log(S("  /mcp add <name> <command> [args]", _.d));
    console.log(S("  example: /mcp add github npx @modelcontextprotocol/server-github\n", _.d));
    return;
  }

  console.log("");
  console.log(S("  mcp servers", _.w, _.b));
  console.log(S("  ─────────────────────────────────", _.d));
  for (const [name, cfg] of servers) {
    const running = !!mcpProcs[name];
    const tools = mcpTools[name] || [];
    const status = running ? S("● running", _.Gr) : S("○ stopped", _.G);
    console.log(`  ${S(name.padEnd(16), _.c)} ${status} ${S(`${tools.length} tools`, _.G)} ${S(cfg.command, _.d)}`);
  }
  console.log("");
}

/**
 * Cleanup all MCP processes
 */
export function cleanupMcp() {
  for (const [name, proc] of Object.entries(mcpProcs)) {
    for (const toolName of (mcpTools[name] || [])) unregisterTool(toolName);
    try { proc.kill(); } catch {}
  }
  mcpProcs = {};
  mcpTools = {};
}

/**
 * Direct tool call for /mcp <server> <tool> <args>
 */
export async function toolMcp({ server, tool, args = {} } = {}) {
  return await callMcpTool(server, tool, args);
}
