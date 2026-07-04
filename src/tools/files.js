// ═══════════════════════════════════════════════════════════════════════════════
// FILE TOOLS — read, write, edit, patch, tree, find, grep
// Inspired by OpenCode tools/ and Codex file operations
// ═══════════════════════════════════════════════════════════════════════════════

import fs from "node:fs/promises";
import path from "node:path";
import { _, S, clip } from "../core/ansi.js";
import { WORKSPACE, MAX_LIST, MAX_DEPTH, MAX_FILE_CHARS, BACKUP_DIR, CACHE_FILE, VERSIONS_DIR } from "../config/state.js";
import { confirm } from "../tui/dialogs.js";
import { state, PROFILES } from "../config/state.js";

// ── Path safety ──
export function normRel(p = ".") {
  const r = path.resolve(WORKSPACE, p);
  const b = WORKSPACE.endsWith(path.sep) ? WORKSPACE : WORKSPACE + path.sep;
  if (r !== WORKSPACE && !r.startsWith(b)) throw new Error(`Fora do workspace: ${p}`);
  return r;
}

export async function fExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

// ── File read tracking (OpenCode pattern) ──
const fileReadTracker = new Map();
function recordFileRead(fp) { fileReadTracker.set(fp, Date.now()); }

// ── Language detection ──
export function detectLang(filepath, content = "") {
  const ext = path.extname(filepath).slice(1).toLowerCase();
  const map = {
    js: "javascript", ts: "typescript", py: "python", rb: "ruby",
    lua: "lua", luau: "lua", rs: "rust", go: "go", java: "java",
    cpp: "cpp", c: "c", h: "c", hpp: "cpp", cs: "csharp",
    json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
    md: "markdown", html: "html", css: "css", scss: "scss",
    sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
    sql: "sql", xml: "xml", svg: "xml",
  };
  return map[ext] || ext || "text";
}

// ── File cache ──
let fileCache = null;
let cacheMtime = 0;

const SKIP_DIRS = [".git", "node_modules", ".cache", "__pycache__", ".bloxcode", ".venv", "dist", "build", ".next"];

async function walkFiles(root, depth = 0) {
  const res = [];
  async function w(cur, d) {
    if (d > MAX_DEPTH) return;
    let items;
    try { items = await fs.readdir(cur, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const full = path.join(cur, it.name);
      if (it.isDirectory()) {
        if (!SKIP_DIRS.includes(it.name)) await w(full, d + 1);
      } else if (it.isFile()) {
        res.push(path.relative(WORKSPACE, full));
        if (res.length >= 2000) return;
      }
    }
  }
  await w(root, 0);
  return res;
}

export async function buildFileCache() {
  fileCache = await walkFiles(WORKSPACE);
  cacheMtime = Date.now();
  await fs.writeFile(CACHE_FILE, JSON.stringify({ files: fileCache, mtime: cacheMtime }), "utf8").catch(() => {});
  return fileCache;
}

export async function getFileCache(force = false) {
  if (!force && fileCache) return fileCache;
  try {
    const d = JSON.parse(await fs.readFile(CACHE_FILE, "utf8"));
    if (Array.isArray(d.files)) { fileCache = d.files; cacheMtime = d.mtime || 0; return fileCache; }
  } catch {}
  return await buildFileCache();
}

// ── Diff engine (improved v4) ──
export function makeDiff(oldText, newText, relPath) {
  const oldL = oldText.split(/\r?\n/);
  const newL = newText.split(/\r?\n/);
  let out = "\n" + S(`📄 ${relPath}`, _.b, _.c) + "\n" + S("─".repeat(56), _.d) + "\n";

  const changed = new Set();
  const maxLen = Math.max(oldL.length, newL.length);
  for (let i = 0; i < maxLen; i++) {
    if ((oldL[i] || "") !== (newL[i] || "")) {
      for (let j = Math.max(0, i - 1); j <= Math.min(maxLen - 1, i + 1); j++) changed.add(j);
    }
  }

  let lastShown = -2, ch = 0;
  for (const i of [...changed].sort((a, b) => a - b)) {
    if (i > lastShown + 1) out += S(`  ${"·".repeat(40)}`, _.d) + "\n";
    if (oldL[i] !== newL[i]) {
      out += S(`@@ ${i + 1} @@`, _.y, _.b) + "\n";
      if (oldL[i] !== undefined) out += S("- " + oldL[i], _.r) + "\n";
      if (newL[i] !== undefined) out += S("+ " + newL[i], _.Gr) + "\n";
      ch++;
    }
    lastShown = i;
  }
  if (!ch) out += S("  (sem mudanças visíveis)", _.G) + "\n";
  return out;
}

// ── Backup ──
async function backupFile(f) {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const content = await fs.readFile(f, "utf8");
    const backupName = path.join(BACKUP_DIR, `${path.basename(f)}.${Date.now()}.bak`);
    await fs.writeFile(backupName, content, "utf8");
    return backupName;
  } catch { return null; }
}

// ══════════════════════════════════════════
// TOOL IMPLEMENTATIONS
// ══════════════════════════════════════════

export async function toolPwd() {
  return { cwd: WORKSPACE };
}

export async function toolLs({ path: rel = "." } = {}) {
  const dir = normRel(rel);
  const ents = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const ent of ents.slice(0, MAX_LIST)) {
    let sz = null;
    const tp = ent.isDirectory() ? "dir" : ent.isSymbolicLink() ? "link" : "file";
    if (!ent.isDirectory()) try { sz = (await fs.stat(path.join(dir, ent.name))).size; } catch {}
    out.push({ name: ent.name, type: tp, size: sz });
  }
  return { path: rel, entries: out, truncated: ents.length > MAX_LIST };
}

export async function toolCat({ path: rel, start = 1, end = 200 } = {}) {
  if (!rel) throw new Error("cat precisa de path");
  const f = normRel(rel);
  const raw = await fs.readFile(f, "utf8");
  recordFileRead(f);
  const lang = detectLang(rel, raw);
  const lines = raw.split(/\r?\n/);
  const st = Math.max(1, Number(start) || 1);
  const en = Math.max(st, Number(end) || 200);
  const content = lines.slice(st - 1, en).map((l, i) => `${String(st + i).padStart(5)} │ ${l}`).join("\n");
  return { path: rel, lang, content: clip(content, MAX_FILE_CHARS) };
}

export async function toolWrite({ path: rel, content } = {}) {
  if (!rel) throw new Error("write precisa de path");
  const f = normRel(rel);
  const newC = String(content ?? "");
  let oldC = ""; try { oldC = await fs.readFile(f, "utf8"); } catch {}
  console.log(makeDiff(oldC, newC, rel));

  const profile = PROFILES[state.currentProfile];
  if (profile.write) {
    const ok = await confirm(S("✏️  Sobrescrever?", _.y));
    if (!ok) return { ok: false, cancelled: true };
  }

  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, newC, "utf8");
  fileCache = null; await getFileCache();
  return { ok: true, path: rel, lang: detectLang(rel, newC), bytes: Buffer.byteLength(newC, "utf8") };
}

export async function toolEdit({ path: rel, startLine, endLine, content } = {}) {
  if (!rel) throw new Error("edit precisa de path");
  const f = normRel(rel);
  const raw = await fs.readFile(f, "utf8");
  const lines = raw.split(/\r?\n/);
  const s = Math.max(1, Number(startLine) || 1);
  const e = Math.max(s, Number(endLine) || s);
  const repl = String(content ?? "").split(/\r?\n/);
  const oldB = lines.slice(s - 1, e).join("\n");
  const newB = repl.join("\n");
  const backup = await backupFile(f);
  if (backup) console.log(S(`   💾 Backup: ${path.basename(backup)}`, _.G));
  console.log(makeDiff(oldB, newB, `${rel} [${s}-${e}]`));

  const profile = PROFILES[state.currentProfile];
  if (profile.edit) {
    const ok = await confirm(S("✏️  Aplicar?", _.y));
    if (!ok) return { ok: false, cancelled: true };
  }

  lines.splice(s - 1, e - s + 1, ...repl);
  await fs.writeFile(f, lines.join("\n"), "utf8");
  fileCache = null; await getFileCache();
  return { ok: true, path: rel, replaced: { start: s, end: e, newLines: repl.length } };
}

export async function toolApplyPatch({ path: rel, patch } = {}) {
  if (!rel) throw new Error("apply_patch precisa de path");
  if (!patch) throw new Error("apply_patch precisa de patch");
  const f = normRel(rel);
  let content; try { content = await fs.readFile(f, "utf8"); } catch { throw new Error(`Não encontrado: ${rel}`); }
  const backup = await backupFile(f);
  if (backup) console.log(S(`   💾 Backup: ${path.basename(backup)}`, _.G));

  // Try SEARCH/REPLACE format first (Claude Code style)
  const sections = String(patch).split(/(?:^|\n)<<<\s*SEARCH\s*>>>\s*\n/m).filter(Boolean);
  for (const section of sections) {
    const parts = section.split(/\n<<<\s*REPLACE\s*>>>\s*\n/);
    if (parts.length === 2) {
      const search = parts[0].trimEnd(), replace = parts[1].trimEnd();
      const idx = content.indexOf(search);
      if (idx !== -1) content = content.slice(0, idx) + replace + content.slice(idx + search.length);
      else return { ok: false, error: `SEARCH block não encontrado` };
    }
  }

  if (sections.length > 0) {
    await fs.writeFile(f, content, "utf8");
    fileCache = null; await getFileCache();
    return { ok: true, path: rel, method: "search-replace" };
  }

  // Try unified diff format
  const lines = content.split(/\r?\n/);
  const patchLines = String(patch).split(/\r?\n/);
  const hunks = [];
  let currentHunk = null;
  for (const line of patchLines) {
    if (line.startsWith("@@")) {
      if (currentHunk) hunks.push(currentHunk);
      const m = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (m) currentHunk = { oldStart: parseInt(m[1]), oldCount: parseInt(m[2] || "1"), lines: [] };
    } else if (currentHunk) {
      currentHunk.lines.push(line);
    }
  }
  if (currentHunk) hunks.push(currentHunk);

  hunks.sort((a, b) => b.oldStart - a.oldStart);
  for (const hunk of hunks) {
    const newLines = [];
    for (const hl of hunk.lines) {
      if (hl.startsWith("-")) continue;
      else if (hl.startsWith("+")) newLines.push(hl.slice(1));
      else newLines.push(hl.startsWith(" ") ? hl.slice(1) : hl);
    }
    lines.splice(hunk.oldStart - 1, hunk.oldCount, ...newLines);
  }

  const newContent = lines.join("\n");
  await fs.writeFile(f, newContent, "utf8");
  fileCache = null; await getFileCache();
  return { ok: true, path: rel, method: "unified-diff", hunks: hunks.length };
}

export async function toolMultiWrite({ files } = {}) {
  if (!files || !Array.isArray(files)) throw new Error("multi_write precisa de files: [{path, content}]");
  const results = [];
  for (const f of files) {
    if (!f.path || f.content == null) { results.push({ path: f.path, ok: false, error: "path+content obrigatórios" }); continue; }
    const res = await toolWrite({ path: f.path, content: f.content });
    results.push({ path: f.path, ...res });
  }
  return { ok: true, results, count: results.length };
}

export async function toolFind({ path: rel = ".", pattern } = {}) {
  if (!pattern) throw new Error("find precisa de pattern");
  const files = await getFileCache();
  const re = new RegExp(pattern, "i");
  const matches = [];
  for (const f of files) { if (re.test(f)) matches.push(f); if (matches.length >= MAX_LIST) break; }
  return { root: rel, pattern, matches, truncated: matches.length >= MAX_LIST };
}

export async function toolGrep({ path: rel = ".", pattern } = {}) {
  if (!pattern) throw new Error("grep precisa de pattern");
  const files = await getFileCache();
  const out = [];
  let rx; try { rx = new RegExp(pattern, "i"); } catch { rx = null; }
  for (const f of files) {
    const full = path.join(WORKSPACE, f);
    let text; try { text = await fs.readFile(full, "utf8"); } catch { continue; }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (rx ? rx.test(lines[i]) : lines[i].includes(pattern)) {
        out.push({ file: f, line: i + 1, text: lines[i].slice(0, 300) });
        if (out.length >= MAX_LIST) return { pattern, matches: out, truncated: true };
      }
    }
  }
  return { pattern, matches: out, truncated: false };
}

export async function toolTree({ path: rel = ".", depth = 3 } = {}) {
  const root = normRel(rel);
  const limit = Math.min(8, Number(depth) || 3);
  const lines = [];
  async function w(cur, d, pref = "") {
    if (d > limit) return;
    let items; try { items = await fs.readdir(cur, { withFileTypes: true }); } catch { return; }
    items.sort((a, b) => a.name.localeCompare(b.name));
    for (let i = 0; i < items.length; i++) {
      const it = items[i], last = i === items.length - 1;
      const icon = it.isDirectory() ? "📁 " : "📄 ";
      lines.push(pref + (last ? "└── " : "├── ") + icon + it.name);
      if (it.isDirectory() && !SKIP_DIRS.includes(it.name)) await w(path.join(cur, it.name), d + 1, pref + (last ? "    " : "│   "));
      if (lines.length >= 500) return;
    }
  }
  lines.push(path.basename(root) || root);
  await w(root, 1, "");
  return { path: rel, tree: lines.join("\n") };
}
