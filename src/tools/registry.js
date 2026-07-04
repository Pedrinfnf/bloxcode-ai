// ═══════════════════════════════════════════════════════════════════════════════
// TOOL REGISTRY — Central registry of all tools (like OpenCode tools/tools.go)
// ═══════════════════════════════════════════════════════════════════════════════

import { _, S } from "../core/ansi.js";
import { trackTool } from "../config/state.js";
import { drawBox } from "../tui/box.js";

import { toolPwd, toolLs, toolCat, toolWrite, toolEdit, toolApplyPatch, toolMultiWrite, toolFind, toolGrep, toolTree } from "./files.js";
import { toolShell, toolGitStatus, toolGitDiff, toolGitCommit, toolGitBranch, toolGitStash, toolGitLog, toolTest, toolDocker, toolPipeline, toolPkg } from "./shell.js";
import { webSearch, toolFetch, generateImage, toolSourcegraph } from "./web.js";

/**
 * Tool definitions — each tool has: fn, desc, args
 */
export const TOOLS = {
  // File tools
  pwd:         { fn: toolPwd,        desc: "Mostra diretório de trabalho", args: [] },
  ls:          { fn: toolLs,         desc: "Lista arquivos", args: ["path?"] },
  cat:         { fn: toolCat,        desc: "Lê arquivo", args: ["path", "start?", "end?"] },
  write:       { fn: toolWrite,      desc: "Escreve arquivo", args: ["path", "content"] },
  edit:        { fn: toolEdit,       desc: "Edita linhas", args: ["path", "startLine", "endLine", "content"] },
  apply_patch: { fn: toolApplyPatch, desc: "Aplica patch (unified/search-replace)", args: ["path", "patch"] },
  multi_write: { fn: toolMultiWrite, desc: "Escreve múltiplos arquivos", args: ["files[]"] },
  find:        { fn: toolFind,       desc: "Busca arquivos por pattern", args: ["path?", "pattern"] },
  grep:        { fn: toolGrep,       desc: "Busca texto em arquivos", args: ["path?", "pattern"] },
  tree:        { fn: toolTree,       desc: "Árvore do diretório", args: ["path?", "depth?"] },

  // Shell tools
  shell:      { fn: toolShell,      desc: "Executa comando shell", args: ["command"] },
  test:       { fn: toolTest,       desc: "Roda testes", args: ["framework?"] },
  docker:     { fn: toolDocker,     desc: "Docker commands", args: ["action", "args?"] },
  pipeline:   { fn: toolPipeline,   desc: "Roda pipeline de comandos", args: ["commands[]"] },
  pkg:        { fn: toolPkg,        desc: "Package manager", args: ["action", "packages[]?"] },

  // Git tools
  gitStatus:  { fn: toolGitStatus,  desc: "Git status", args: [] },
  gitDiff:    { fn: toolGitDiff,    desc: "Git diff", args: [] },
  gitCommit:  { fn: toolGitCommit,  desc: "Git commit", args: ["message"] },
  gitBranch:  { fn: toolGitBranch,  desc: "Git new branch", args: ["name"] },
  gitStash:   { fn: toolGitStash,   desc: "Git stash", args: [] },
  gitLog:     { fn: toolGitLog,     desc: "Git log", args: ["count?"] },

  // Web tools
  search:      { fn: async (a) => webSearch(a.query),    desc: "Busca na web", args: ["query"] },
  fetch:       { fn: toolFetch,                            desc: "Busca URL", args: ["url", "maxChars?"] },
  image:       { fn: async (a) => generateImage(a.prompt), desc: "Gera imagem", args: ["prompt"] },
  sourcegraph: { fn: toolSourcegraph,                      desc: "Busca código no Sourcegraph", args: ["query", "repo?"] },
};

/**
 * Run a tool by name with args
 */
export async function runTool(name, args = {}) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Tool desconhecida: ${name}`);
  trackTool(name);
  try {
    return await tool.fn(args);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Get tool descriptions for system prompt
 */
export function getToolDescriptions() {
  return Object.entries(TOOLS).map(([name, t]) => {
    const argStr = t.args.length ? `(${t.args.join(", ")})` : "()";
    return `- ${name}${argStr}: ${t.desc}`;
  }).join("\n");
}

/**
 * Print tools list
 */
export function printToolsList() {
  const lines = Object.entries(TOOLS).map(([name, t]) => {
    const argStr = t.args.length ? S(`(${t.args.join(", ")})`, _.G) : "";
    return `  ${S(name.padEnd(14), _.c, _.b)} ${argStr} ${S(t.desc, _.w)}`;
  });
  console.log(drawBox(lines, { title: S("🔧 TOOLS", _.c), color: _.c, w: 76 }));
}
