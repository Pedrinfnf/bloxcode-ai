// ═══════════════════════════════════════════════════════════════════════════════
// APP STATE & CONFIG — v4.1
// API key now runtime-configurable via /api command, persisted to config
// ═══════════════════════════════════════════════════════════════════════════════

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

// ── PATHS ──
export const WORKSPACE = path.resolve(process.env.AGENT_ROOT || process.cwd());
export const SESSION_ID = crypto.createHash("sha1").update(WORKSPACE).digest("hex").slice(0, 10);

export const HOME_BLOXCODE = path.join(os.homedir(), ".bloxcode");
export const BLOXCODE_DIR = path.join(WORKSPACE, ".bloxcode");
export const HISTORY_FILE = path.join(BLOXCODE_DIR, "history.json");
export const CACHE_FILE = path.join(BLOXCODE_DIR, "cache.json");
export const CONFIG_FILE = path.join(BLOXCODE_DIR, "config.json");
export const GLOBAL_CONFIG = path.join(HOME_BLOXCODE, "config.json");
export const BACKUP_DIR = path.join(BLOXCODE_DIR, "backups");
export const SHELL_HISTORY = path.join(BLOXCODE_DIR, "shell-history");
export const SKILLS_DIR = path.join(BLOXCODE_DIR, "skills");
export const SNAPSHOTS_DIR = path.join(BLOXCODE_DIR, "snapshots");
export const ALIASES_FILE = path.join(BLOXCODE_DIR, "aliases.json");
export const STATS_FILE = path.join(BLOXCODE_DIR, "stats.json");
export const MCP_CONFIG_FILE = path.join(BLOXCODE_DIR, "mcp.json");
export const VERSIONS_DIR = path.join(BLOXCODE_DIR, "versions");
export const SESSIONS_DIR = path.join(BLOXCODE_DIR, "sessions");
export const CONVENTIONS_FILE = path.join(WORKSPACE, ".bloxcode.md");

// ── LIMITS ──
export const MAX_OUT = 12000;
export const MAX_FILE_CHARS = 24000;
export const MAX_LIST = 200;
export const MAX_DEPTH = 4;
export const FETCH_TIMEOUT = 120000;
export const MAX_RETRIES = 3;
export const COMPACT_THRESHOLD = 120000;
export const MAX_TOKENS = 4096;
export const BELL_THRESHOLD = 15000;

// ── PROVIDER CONFIG ──
export const TITLE = (process.env.OPENROUTER_TITLE || "BloxCode").trim();
export const REFERER = (process.env.OPENROUTER_REFERER || "http://localhost").trim();

// ── OPERATION MODES ──
export const MODES = {
  suggest:  { name: "SUGGEST",   desc: "Sugere ações, não executa", color: "\x1b[33m", icon: "💡" },
  autoedit: { name: "AUTO-EDIT", desc: "Edita sem confirmar, shell confirma", color: "\x1b[92m", icon: "✏️" },
  fullauto: { name: "FULL-AUTO", desc: "Executa tudo sem confirmar", color: "\x1b[31m", icon: "🔥" },
  plan:     { name: "PLAN",      desc: "Planeja antes de executar (multi-step)", color: "\x1b[35m", icon: "📋" },
  scout:    { name: "SCOUT",     desc: "Pesquisa repo antes de responder", color: "\x1b[36m", icon: "🔍" },
};

// ── APPROVAL PROFILES ──
export const PROFILES = {
  safe: { name: "SAFE", desc: "Tudo requer confirmação", shell: true, edit: true, write: true, icon: "🛡️" },
  edit: { name: "EDIT", desc: "Shell confirma, edit/write não", shell: true, edit: false, write: false, icon: "✏️" },
  full: { name: "FULL", desc: "Nada requer confirmação", shell: false, edit: false, write: false, icon: "🔥" },
};

// ── REASONING LEVELS ──
export const VALID_REASONING = ["off", "low", "medium", "high"];

// ═════════════════════════════════════════════════════════════════════════════
// SESSION STATE (runtime, mutable)
// ═════════════════════════════════════════════════════════════════════════════
export const state = {
  currentMode: "suggest",
  currentProfile: "safe",
  reasoningLevel: "off",
  messages: [],
  lastUsage: null,
  lastCost: null,
  apiKey: "",          // ← runtime API key — set via /api, persisted to global config
  apiBaseUrl: "https://openrouter.ai/api/v1",
  currentSessionId: null,
};

// ═════════════════════════════════════════════════════════════════════════════
// API KEY MANAGEMENT
// The key is resolved from (in priority order):
//   1. /api command (saved to ~/.bloxcode/config.json)
//   2. OPENROUTER_API_KEY env var
//   3. Previously saved key in global config
// ═════════════════════════════════════════════════════════════════════════════
export function getApiKey() {
  return state.apiKey || "";
}

export async function setApiKey(key) {
  state.apiKey = key.trim();
  // Persist to global config (not project-level — it's a credential)
  await fs.mkdir(HOME_BLOXCODE, { recursive: true }).catch(() => {});
  const globalCfg = await loadGlobalConfig();
  globalCfg.apiKey = state.apiKey;
  if (state.apiBaseUrl !== "https://openrouter.ai/api/v1") {
    globalCfg.apiBaseUrl = state.apiBaseUrl;
  }
  await fs.writeFile(GLOBAL_CONFIG, JSON.stringify(globalCfg, null, 2), "utf8").catch(() => {});
}

export async function setApiBaseUrl(url) {
  state.apiBaseUrl = url.trim().replace(/\/+$/, "");
  const globalCfg = await loadGlobalConfig();
  globalCfg.apiBaseUrl = state.apiBaseUrl;
  await fs.writeFile(GLOBAL_CONFIG, JSON.stringify(globalCfg, null, 2), "utf8").catch(() => {});
}

async function loadGlobalConfig() {
  try { return JSON.parse(await fs.readFile(GLOBAL_CONFIG, "utf8")); }
  catch { return {}; }
}

async function resolveApiKey() {
  // 1. Env var (highest priority)
  const envKey = (process.env.OPENROUTER_API_KEY || "").trim();
  if (envKey) { state.apiKey = envKey; return; }
  // 2. Global config
  const globalCfg = await loadGlobalConfig();
  if (globalCfg.apiKey) state.apiKey = globalCfg.apiKey;
  if (globalCfg.apiBaseUrl) state.apiBaseUrl = globalCfg.apiBaseUrl;
}

// ═════════════════════════════════════════════════════════════════════════════
// SESSION STATS
// ═════════════════════════════════════════════════════════════════════════════
export const sessionStats = {
  startTime: Date.now(),
  messagesSent: 0,
  toolCalls: 0,
  toolCallsByType: {},
  tokensUsed: { prompt: 0, completion: 0, total: 0 },
  totalCost: 0,
  errors: 0,
  filesModified: 0,
  shellsRun: 0,
  searchesRun: 0,
  imagesGenerated: 0,
  streamingChunks: 0,
  fallbacks: 0,
};

export function trackTool(name) {
  sessionStats.toolCalls++;
  sessionStats.toolCallsByType[name] = (sessionStats.toolCallsByType[name] || 0) + 1;
  if (name === "shell") sessionStats.shellsRun++;
  if (["write", "edit", "apply_patch", "multi_write"].includes(name)) sessionStats.filesModified++;
}

export function trackUsage(usage, cost) {
  if (!usage) return;
  sessionStats.tokensUsed.prompt += usage.prompt_tokens || 0;
  sessionStats.tokensUsed.completion += usage.completion_tokens || 0;
  sessionStats.tokensUsed.total += usage.total_tokens || 0;
  sessionStats.totalCost += cost?.total || 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// CONFIG PERSISTENCE
// ═════════════════════════════════════════════════════════════════════════════
export async function ensureDirs() {
  for (const d of [HOME_BLOXCODE, BLOXCODE_DIR, BACKUP_DIR, SKILLS_DIR, SNAPSHOTS_DIR, VERSIONS_DIR, SESSIONS_DIR]) {
    await fs.mkdir(d, { recursive: true }).catch(() => {});
  }
}

export async function loadConfig() {
  await resolveApiKey();
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    const cfg = JSON.parse(raw);
    if (cfg.currentMode && MODES[cfg.currentMode]) state.currentMode = cfg.currentMode;
    if (cfg.currentProfile && PROFILES[cfg.currentProfile]) state.currentProfile = cfg.currentProfile;
    if (cfg.reasoningLevel && VALID_REASONING.includes(cfg.reasoningLevel)) state.reasoningLevel = cfg.reasoningLevel;
    return cfg;
  } catch { return {}; }
}

export async function saveConfig(extra = {}) {
  const data = {
    currentMode: state.currentMode,
    currentProfile: state.currentProfile,
    reasoningLevel: state.reasoningLevel,
    ...extra,
  };
  await fs.writeFile(CONFIG_FILE, JSON.stringify(data, null, 2), "utf8").catch(() => {});
}

// ── HISTORY ──
export async function loadHistory() {
  try {
    const data = JSON.parse(await fs.readFile(HISTORY_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

export async function saveHistory(msgs) {
  await fs.writeFile(HISTORY_FILE, JSON.stringify(msgs, null, 2), "utf8").catch(() => {});
}

// ── MULTI-SESSION (inspired by OpenCode sessions) ──
export async function listSessions() {
  try {
    const entries = await fs.readdir(SESSIONS_DIR, { withFileTypes: true });
    const sessions = [];
    for (const ent of entries) {
      if (ent.isFile() && ent.name.endsWith(".json")) {
        try {
          const raw = await fs.readFile(path.join(SESSIONS_DIR, ent.name), "utf8");
          const data = JSON.parse(raw);
          sessions.push({ id: ent.name.replace(".json", ""), title: data.title || "Untitled", messages: data.messages?.length || 0, created: data.created });
        } catch {}
      }
    }
    return sessions.sort((a, b) => (b.created || 0) - (a.created || 0));
  } catch { return []; }
}

export async function saveSession(id, title, messages) {
  const filepath = path.join(SESSIONS_DIR, `${id}.json`);
  await fs.writeFile(filepath, JSON.stringify({ title, messages, created: Date.now() }, null, 2), "utf8").catch(() => {});
}

export async function loadSession(id) {
  try {
    const raw = await fs.readFile(path.join(SESSIONS_DIR, `${id}.json`), "utf8");
    return JSON.parse(raw);
  } catch { return null; }
}

// ── ALIASES ──
let userAliases = {};

export async function loadAliases() {
  try { userAliases = JSON.parse(await fs.readFile(ALIASES_FILE, "utf8")); }
  catch { userAliases = {}; }
  return userAliases;
}

export async function saveAliases(aliases) {
  if (aliases) userAliases = aliases;
  await fs.writeFile(ALIASES_FILE, JSON.stringify(userAliases, null, 2), "utf8").catch(() => {});
}

export function getAliases() { return userAliases; }

export function resolveAlias(line) {
  if (!line.startsWith("@")) return line;
  const parts = line.slice(1).split(/\s+/);
  const name = parts[0];
  if (userAliases[name]) {
    const rest = parts.slice(1).join(" ");
    return userAliases[name] + (rest ? " " + rest : "");
  }
  return line;
}

// ── CONVENTIONS ──
export async function loadConventions() {
  for (const f of [
    path.join(WORKSPACE, ".bloxcode.md"),
    path.join(WORKSPACE, "AGENTS.md"),
    path.join(WORKSPACE, "CLAUDE.md"),
    path.join(HOME_BLOXCODE, "conventions.md"),
  ]) {
    try { return (await fs.readFile(f, "utf8")).slice(0, 12000); } catch {}
  }
  return "";
}

// ── SKILLS ──
export async function loadSkills() {
  const skills = [];
  try {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        try {
          const content = await fs.readFile(path.join(SKILLS_DIR, ent.name, "SKILL.md"), "utf8");
          skills.push({ name: ent.name, content: content.slice(0, 8000) });
        } catch {}
      }
    }
  } catch {}
  return skills;
}
