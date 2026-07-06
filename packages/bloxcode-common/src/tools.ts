// ═══════════════════════════════════════════════════════════════════════════════
// TOOL REGISTRY — Dynamic tool registration with TypeScript types
// ═══════════════════════════════════════════════════════════════════════════════

import type { ToolDefinition, ToolResult } from "./types.js";

const tools: Map<string, ToolDefinition> = new Map();

export function registerTool(tool: ToolDefinition): void {
  tools.set(tool.name, tool);
}

export function unregisterTool(name: string): void {
  tools.delete(name);
}

export function getTool(name: string): ToolDefinition | undefined {
  return tools.get(name);
}

export function getAllTools(): ToolDefinition[] {
  return Array.from(tools.values());
}

export async function runTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const tool = tools.get(name);
  if (!tool) {
    return { ok: false, error: `Unknown tool: ${name}. Available: ${Array.from(tools.keys()).join(", ")}` };
  }
  try {
    return await tool.fn(args);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function getToolDescriptions(): string {
  const byCategory = new Map<string, ToolDefinition[]>();
  for (const tool of tools.values()) {
    const cat = tool.category || "custom";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(tool);
  }

  const labels: Record<string, string> = {
    fs: "File System", shell: "Shell & Build", git: "Git",
    web: "Web & Search", mcp: "MCP (external)", custom: "Custom",
  };

  const order = ["fs", "shell", "git", "web", "mcp", "custom"];
  return order
    .filter(cat => byCategory.has(cat))
    .map(cat => {
      const tools = byCategory.get(cat)!;
      const header = labels[cat] || cat;
      const lines = tools.map(t => `  - ${t.name}(${t.args.join(", ")}): ${t.description}`);
      return `${header}:\n${lines.join("\n")}`;
    })
    .join("\n\n");
}
