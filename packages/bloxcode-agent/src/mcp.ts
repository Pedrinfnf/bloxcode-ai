// ═══════════════════════════════════════════════════════════════════════════════
// MCP CLIENT — Connects to MCP servers, discovers and registers tools
// ═══════════════════════════════════════════════════════════════════════════════

import { spawn, type ChildProcess } from "node:child_process";
import type { MCPServer, MCPToolInfo, ToolResult } from "@bloxcode/common";
import { registerTool, unregisterTool } from "@bloxcode/common";

interface MCPConnection {
  proc: ChildProcess;
  tools: string[];
}

export class MCPClient {
  private connections = new Map<string, MCPConnection>();

  async start(server: MCPServer, cwd: string): Promise<{ ok: boolean; tools: number; error?: string }> {
    if (this.connections.has(server.name)) return { ok: true, tools: 0 };

    try {
      const proc = spawn(server.command, server.args, {
        cwd,
        env: { ...process.env, ...server.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      proc.on("exit", () => {
        const conn = this.connections.get(server.name);
        if (conn) { conn.tools.forEach(t => unregisterTool(t)); this.connections.delete(server.name); }
      });

      // Initialize
      await this.rpc(proc, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "BloxCode", version: "0.1.0" },
      });

      // Discover tools
      const result = await this.rpc(proc, "tools/list", {}) as any;
      const mcpTools: MCPToolInfo[] = result?.tools || [];
      const toolNames: string[] = [];

      for (const tool of mcpTools) {
        const toolId = `mcp:${server.name}:${tool.name}`;
        const argNames = tool.inputSchema?.properties ? Object.keys(tool.inputSchema.properties) : [];

        registerTool({
          name: toolId,
          description: `[MCP:${server.name}] ${tool.description || tool.name}`,
          args: argNames,
          category: "mcp",
          fn: async (args) => this.callTool(server.name, tool.name, args),
        });
        toolNames.push(toolId);
      }

      this.connections.set(server.name, { proc, tools: toolNames });
      return { ok: true, tools: mcpTools.length };
    } catch (err) {
      return { ok: false, tools: 0, error: (err as Error).message };
    }
  }

  async stop(name: string) {
    const conn = this.connections.get(name);
    if (!conn) return;
    conn.tools.forEach(t => unregisterTool(t));
    try { conn.proc.kill(); } catch {}
    this.connections.delete(name);
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const conn = this.connections.get(serverName);
    if (!conn) return { ok: false, error: `MCP '${serverName}' not running` };
    try {
      const result = await this.rpc(conn.proc, "tools/call", { name: toolName, arguments: args });
      return { ok: true, result } as any;
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  getStatus(): Array<{ name: string; running: boolean; tools: number }> {
    return Array.from(this.connections.entries()).map(([name, conn]) => ({
      name,
      running: !conn.proc.killed,
      tools: conn.tools.length,
    }));
  }

  stopAll() {
    for (const [name] of this.connections) this.stop(name);
  }

  private rpc(proc: ChildProcess, method: string, params: any, timeout = 15000): Promise<any> {
    return new Promise((resolve, reject) => {
      let resp = "";
      const timer = setTimeout(() => { cleanup(); reject(new Error("MCP timeout")); }, timeout);
      const onData = (chunk: Buffer) => {
        resp += chunk.toString();
        for (const line of resp.split("\n")) {
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
      const cleanup = () => { clearTimeout(timer); proc.stdout?.removeListener("data", onData); };
      proc.stdout?.on("data", onData);
      proc.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) + "\n");
    });
  }
}
