// ═══════════════════════════════════════════════════════════════════════════════
// HOOKS SYSTEM — Inspired by Claude Code's hooks (PreToolUse, PostToolUse, etc)
// Hooks run custom logic before/after tool calls, on user input, on stop
// ═══════════════════════════════════════════════════════════════════════════════

import { _, S } from "./ansi.js";
import path from "node:path";

// ── Security patterns (inspired by Claude Code security-guidance plugin) ──
const SECURITY_PATTERNS = [
  {
    name: "eval_injection",
    test: (content) => /\beval\s*\(/.test(content),
    warn: "⚠️ eval() detectado — risco de injeção de código. Prefira JSON.parse() ou alternativas seguras.",
  },
  {
    name: "child_process_exec",
    test: (content) => /child_process\.exec\b|execSync\(/.test(content),
    warn: "⚠️ child_process.exec() detectado — risco de command injection. Prefira execFile() com array de args.",
  },
  {
    name: "innerHTML_xss",
    test: (content) => /\.innerHTML\s*=/.test(content),
    warn: "⚠️ innerHTML= detectado — risco de XSS. Use textContent ou createElement().",
  },
  {
    name: "dangerouslySetInnerHTML",
    test: (content) => /dangerouslySetInnerHTML/.test(content),
    warn: "⚠️ dangerouslySetInnerHTML detectado — sanitize o conteúdo com DOMPurify.",
  },
  {
    name: "hardcoded_secrets",
    test: (content) => /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}/i.test(content),
    warn: "⚠️ Possível secret/key hardcoded detectada. Use variáveis de ambiente.",
  },
  {
    name: "sql_injection",
    test: (content) => /\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|DROP|WHERE)/i.test(content) || /['"].*\+.*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/i.test(content),
    warn: "⚠️ Possível SQL injection. Use parameterized queries.",
  },
  {
    name: "rm_rf",
    test: (content) => /rm\s+-rf\s+[\/~]/.test(content),
    warn: "🚨 rm -rf em diretório raiz/home detectado! Extremamente perigoso.",
  },
  {
    name: "pickle_deserialization",
    test: (content) => /pickle\.load|cPickle|cloudpickle|joblib\.load|torch\.load/.test(content),
    warn: "⚠️ Deserialização insegura (pickle/torch). Permite execução arbitrária de código.",
  },
];

/**
 * Check content for security patterns — runs PreToolUse on write/edit
 * Returns array of warnings
 */
export function checkSecurity(content, filepath = "") {
  const warnings = [];
  for (const pattern of SECURITY_PATTERNS) {
    if (pattern.test(content)) {
      warnings.push(pattern.warn);
    }
  }
  // GitHub Actions specific
  if (filepath.includes(".github/workflows") && /\$\{\{.*github\.event/.test(content)) {
    warnings.push("⚠️ GitHub Actions: input não sanitizado em workflow. Risco de command injection.");
  }
  return warnings;
}

/**
 * Print security warnings
 */
export function printSecurityWarnings(warnings) {
  if (!warnings.length) return;
  console.log(S("\n┌─ 🔒 SECURITY WARNINGS ─────────────────────────", _.y));
  for (const w of warnings) {
    console.log(S("│ ", _.y) + S(w, _.Y));
  }
  console.log(S("└────────────────────────────────────────────────\n", _.y));
}

// ── Hooks registry ──
const hooks = {
  PreToolUse: [],
  PostToolUse: [],
  UserPromptSubmit: [],
  Stop: [],
};

export function registerHook(event, fn) {
  if (hooks[event]) hooks[event].push(fn);
}

export async function runHooks(event, data) {
  const results = [];
  for (const fn of (hooks[event] || [])) {
    try { results.push(await fn(data)); }
    catch (err) { results.push({ error: err.message }); }
  }
  return results;
}

// ── Register default security hook ──
registerHook("PreToolUse", async (data) => {
  const { tool, args } = data;
  if (["write", "edit", "apply_patch", "multi_write"].includes(tool)) {
    const content = args?.content || args?.patch || "";
    const filepath = args?.path || "";
    const warnings = checkSecurity(content, filepath);
    if (warnings.length) printSecurityWarnings(warnings);
  }
  return { ok: true };
});
