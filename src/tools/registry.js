// ═══════════════════════════════════════════════════════════════════════════════
// TOOL REGISTRY — v0.0.11 — Dynamic registry: built-in + MCP + custom
// MCP tools are discovered at startup and registered as real callable tools
// ═══════════════════════════════════════════════════════════════════════════════

import { _, S } from "../core/ansi.js";
import { trackTool } from "../config/state.js";
import { drawBox } from "../tui/box.js";

import { toolPwd, toolLs, toolCat, toolWrite, toolEdit, toolApplyPatch, toolMultiWrite, toolFind, toolGrep, toolTree } from "./files.js";
import { toolShell, toolGitStatus, toolGitDiff, toolGitCommit, toolGitBranch, toolGitStash, toolGitLog, toolTest, toolDocker, toolPipeline, toolPkg } from "./shell.js";
import { webSearch, toolFetch, generateImage, toolSourcegraph } from "./web.js";

/**
 * BUILT-IN tool definitions
 */
const BUILTIN_TOOLS = {
  pwd:         { fn: toolPwd,        desc: "Show working directory", args: [], category: "fs" },
  ls:          { fn: toolLs,         desc: "List files in directory", args: ["path?"], category: "fs" },
  cat:         { fn: toolCat,        desc: "Read file contents", args: ["path", "start?", "end?"], category: "fs" },
  write:       { fn: toolWrite,      desc: "Create or overwrite file", args: ["path", "content"], category: "fs" },
  edit:        { fn: toolEdit,       desc: "Edit specific lines in file", args: ["path", "startLine", "endLine", "content"], category: "fs" },
  apply_patch: { fn: toolApplyPatch, desc: "Apply patch (unified diff or search/replace)", args: ["path", "patch"], category: "fs" },
  multi_write: { fn: toolMultiWrite, desc: "Write multiple files at once", args: ["files[]"], category: "fs" },
  find:        { fn: toolFind,       desc: "Find files by name pattern", args: ["path?", "pattern"], category: "fs" },
  grep:        { fn: toolGrep,       desc: "Search text content in files", args: ["path?", "pattern"], category: "fs" },
  tree:        { fn: toolTree,       desc: "Show directory tree", args: ["path?", "depth?"], category: "fs" },
  shell:       { fn: toolShell,      desc: "Execute shell command (bash)", args: ["command"], category: "shell" },
  test:        { fn: toolTest,       desc: "Run project tests (auto-detect framework)", args: ["framework?"], category: "shell" },
  docker:      { fn: toolDocker,     desc: "Run docker command", args: ["action", "args?"], category: "shell" },
  pipeline:    { fn: toolPipeline,   desc: "Run sequential commands (stop on fail)", args: ["commands[]"], category: "shell" },
  pkg:         { fn: toolPkg,        desc: "Package manager (auto-detect npm/pnpm/yarn/bun)", args: ["action", "packages[]?"], category: "shell" },
  gitStatus:   { fn: toolGitStatus,  desc: "Git status", args: [], category: "git" },
  gitDiff:     { fn: toolGitDiff,    desc: "Git diff", args: [], category: "git" },
  gitCommit:   { fn: toolGitCommit,  desc: "Git add + commit", args: ["message"], category: "git" },
  gitBranch:   { fn: toolGitBranch,  desc: "Git create + checkout branch", args: ["name"], category: "git" },
  gitStash:    { fn: toolGitStash,   desc: "Git stash", args: [], category: "git" },
  gitLog:      { fn: toolGitLog,     desc: "Git log (recent commits)", args: ["count?"], category: "git" },
  search:      { fn: async (a) => webSearch(a.query), desc: "Search the web (DuckDuckGo)", args: ["query"], category: "web" },
  fetch:       { fn: toolFetch, desc: "Fetch URL content (HTML stripped)", args: ["url", "maxChars?"], category: "web" },
  image:       { fn: async (a) => generateImage(a.prompt), desc: "Generate image from prompt", args: ["prompt"], category: "web" },
  sourcegraph: { fn: toolSourcegraph, desc: "Search code on Sourcegraph", args: ["query", "repo?"], category: "web" },
};

/**
 * Dynamic tool store — starts with builtins, MCP tools added at runtime
 */
const TOOLS = { ...BUILTIN_TOOLS };

/**
 * Register a new tool dynamically (used by MCP discovery)
 */
export function registerTool(name, fn, desc, args = [], category = "mcp") {
  TOOLS[name] = { fn, desc, args, category };
}

/**
 * Remove a dynamic tool
 */
export function unregisterTool(name) {
  if (!BUILTIN_TOOLS[name]) delete TOOLS[name]; // never remove builtins
}

/**
 * Get all registered tools
 */
export function getAllTools() {
  return TOOLS;
}

/**
 * Run a tool by name with args
 */
export async function runTool(name, args = {}) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Tool desconhecida: ${name}. Tools disponíveis: ${Object.keys(TOOLS).join(", ")}`);
  trackTool(name);
  try {
    return await tool.fn(args);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Get tool descriptions for system prompt — grouped by category
 */
export function getToolDescriptions() {
  const categories = {};
  for (const [name, t] of Object.entries(TOOLS)) {
    const cat = t.category || "other";
    if (!categories[cat]) categories[cat] = [];
    const argStr = t.args.length ? `(${t.args.join(", ")})` : "()";
    categories[cat].push(`  - ${name}${argStr}: ${t.desc}`);
  }

  const order = ["fs", "shell", "git", "web", "mcp", "other"];
  const labels = { fs: "File System", shell: "Shell & Build", git: "Git", web: "Web & Search", mcp: "MCP (external)", other: "Other" };

  return order
    .filter(cat => categories[cat]?.length)
    .map(cat => `### ${labels[cat] || cat}\n${categories[cat].join("\n")}`)
    .join("\n\n");
}

/**
 * Print tools list
 */
export function printToolsList() {
  const categories = {};
  for (const [name, t] of Object.entries(TOOLS)) {
    const cat = t.category || "other";
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push({ name, ...t });
  }

  const labels = { fs: "File System", shell: "Shell & Build", git: "Git", web: "Web & Search", mcp: "MCP (external)", other: "Other" };

  console.log("");
  for (const [cat, tools] of Object.entries(categories)) {
    console.log(S(`  ${labels[cat] || cat}`, _.w, _.b));
    for (const t of tools) {
      const argStr = t.args.length ? S(`(${t.args.join(", ")})`, _.G) : "";
      console.log(`    ${S(t.name.padEnd(14), _.c)} ${argStr} ${S(t.desc, _.G)}`);
    }
    console.log("");
  }
}
