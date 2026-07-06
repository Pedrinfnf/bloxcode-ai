// ═══════════════════════════════════════════════════════════════════════════════
// BUILTIN TOOLS — File, Shell, Git, Web tools with TypeScript types
// ═══════════════════════════════════════════════════════════════════════════════

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import type { ToolResult } from "@bloxcode/common";
import { registerTool } from "@bloxcode/common";

const exec = promisify(execFile);

let workspace = process.cwd();

export function setWorkspace(dir: string) { workspace = dir; }

function safe(p: string): string {
  const full = path.resolve(workspace, p);
  if (!full.startsWith(workspace)) throw new Error(`Outside workspace: ${p}`);
  return full;
}

function clip(s: string, max = 12000): string {
  return s.length <= max ? s : s.slice(0, max) + `\n...(${s.length - max} chars truncated)`;
}

async function shell(command: string): Promise<ToolResult> {
  try {
    const r = await exec("bash", ["-lc", command], { cwd: workspace, maxBuffer: 1024 * 1024, timeout: 120000 });
    return { ok: true, code: 0, stdout: clip(r.stdout || ""), stderr: clip(r.stderr || "") };
  } catch (err: any) {
    return { ok: false, code: err.code || 1, error: err.message, stderr: clip(err.stderr || "") };
  }
}

export function registerBuiltinTools() {
  const t = (name: string, desc: string, args: string[], cat: "fs" | "shell" | "git" | "web", fn: (a: any) => Promise<ToolResult>) =>
    registerTool({ name, description: desc, args, category: cat, fn });

  // ── File tools ──
  t("cat", "Read file contents", ["path", "start?", "end?"], "fs", async (a) => {
    const content = await fs.readFile(safe(a.path), "utf8");
    const lines = content.split("\n");
    const s = Math.max(1, Number(a.start) || 1);
    const e = Math.min(lines.length, Number(a.end) || 200);
    return { ok: true, path: a.path, content: clip(lines.slice(s - 1, e).map((l, i) => `${String(s + i).padStart(5)} | ${l}`).join("\n")) };
  });

  t("write", "Create or overwrite file", ["path", "content"], "fs", async (a) => {
    const f = safe(a.path);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, String(a.content || ""), "utf8");
    return { ok: true, path: a.path, bytes: Buffer.byteLength(String(a.content || "")) };
  });

  t("edit", "Edit specific lines", ["path", "startLine", "endLine", "content"], "fs", async (a) => {
    const f = safe(a.path);
    const raw = await fs.readFile(f, "utf8");
    const lines = raw.split("\n");
    const s = Math.max(1, Number(a.startLine) || 1);
    const e = Math.max(s, Number(a.endLine) || s);
    lines.splice(s - 1, e - s + 1, ...String(a.content || "").split("\n"));
    await fs.writeFile(f, lines.join("\n"), "utf8");
    return { ok: true, path: a.path, replaced: { start: s, end: e } };
  });

  t("ls", "List directory", ["path?"], "fs", async (a) => {
    const entries = await fs.readdir(safe(a.path || "."), { withFileTypes: true });
    return { ok: true, entries: entries.slice(0, 200).map(e => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" })) };
  });

  t("find", "Find files by pattern", ["pattern", "path?"], "fs", async (a) => {
    const r = await shell(`find ${a.path || "."} -name "${a.pattern}" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -100`);
    return { ok: true, matches: (r.stdout as string || "").trim().split("\n").filter(Boolean) };
  });

  t("grep", "Search text in files", ["pattern", "path?"], "fs", async (a) => {
    const r = await shell(`grep -rn --include="*.*" "${a.pattern}" ${a.path || "."} 2>/dev/null | head -50`);
    return { ok: true, matches: (r.stdout as string || "").trim().split("\n").filter(Boolean) };
  });

  t("tree", "Show directory tree", ["path?", "depth?"], "fs", async (a) => {
    const r = await shell(`find ${a.path || "."} -maxdepth ${a.depth || 3} -not -path "*/node_modules/*" -not -path "*/.git/*" | head -200 | sort`);
    return { ok: true, tree: r.stdout };
  });

  // ── Shell tools ──
  t("shell", "Execute bash command", ["command"], "shell", async (a) => shell(String(a.command)));

  t("test", "Run project tests", ["framework?"], "shell", async (a) => {
    const fw = String(a.framework || "auto").toLowerCase();
    let cmd = "";
    if (fw === "auto") {
      try { await fs.access(path.join(workspace, "package.json")); cmd = "npm test"; } catch {}
      if (!cmd) try { await fs.access(path.join(workspace, "Cargo.toml")); cmd = "cargo test"; } catch {}
      if (!cmd) try { await fs.access(path.join(workspace, "go.mod")); cmd = "go test ./..."; } catch {}
      if (!cmd) return { ok: false, error: "No test framework detected" };
    } else cmd = fw === "npm" ? "npm test" : fw === "cargo" ? "cargo test" : fw;
    return shell(cmd);
  });

  t("docker", "Run docker command", ["action", "args?"], "shell", async (a) => shell(`docker ${a.action} ${a.args || ""}`));
  t("pkg", "Package manager", ["action", "packages?"], "shell", async (a) => shell(`npm ${a.action} ${a.packages || ""}`));

  // ── Git tools ──
  t("gitStatus", "Git status", [], "git", async () => shell("git status --short"));
  t("gitDiff", "Git diff", [], "git", async () => shell("git diff"));
  t("gitCommit", "Git add + commit", ["message"], "git", async (a) => shell(`git add -A && git commit -m "${a.message}"`));
  t("gitBranch", "Create branch", ["name"], "git", async (a) => shell(`git checkout -b ${a.name}`));
  t("gitStash", "Git stash", [], "git", async () => shell("git stash"));
  t("gitLog", "Git log", ["count?"], "git", async (a) => shell(`git log --oneline -${a.count || 10}`));

  // ── Web tools ──
  t("search", "Web search", ["query"], "web", async (a) => {
    const q = encodeURIComponent(String(a.query));
    try {
      const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${q}`, { headers: { "User-Agent": "Mozilla/5.0" } });
      const html = await res.text();
      const results: string[] = [];
      const re = /<a[^>]+class="result-link"[^>]*>(.*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html)) !== null) results.push(m[1].replace(/<[^>]+>/g, "").trim());
      return { ok: true, results: results.slice(0, 5) };
    } catch (err) { return { ok: false, error: (err as Error).message }; }
  });

  t("fetch", "Fetch URL", ["url"], "web", async (a) => {
    try {
      const res = await fetch(String(a.url), { headers: { "User-Agent": "BloxCode/0.1" } });
      const text = await res.text();
      const clean = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return { ok: true, content: clip(clean, 8000) };
    } catch (err) { return { ok: false, error: (err as Error).message }; }
  });
}
