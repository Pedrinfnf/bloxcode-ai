// ═══════════════════════════════════════════════════════════════════════════════
// SHELL, GIT, TEST, DOCKER TOOLS
// Inspired by OpenCode tools/bash.go and Codex sandbox execution
// ═══════════════════════════════════════════════════════════════════════════════

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { _, S, clip } from "../core/ansi.js";
import { WORKSPACE, SHELL_HISTORY, state, PROFILES } from "../config/state.js";
import { confirm } from "../tui/dialogs.js";
import { fExists } from "./files.js";

const execFileAsync = promisify(execFile);

// ── Dangerous command detection (like Codex sandbox) ──
function isDangerous(cmd) {
  const c = String(cmd || "");
  return /(^|\s)(rm\s+-rf|dd\s+|mkfs|fdisk|parted|shutdown|reboot|poweroff|chmod\s+777|chown\s+-R|sudo\s+)\b/i.test(c) ||
    /curl\s+.*\|\s*(sh|bash)/i.test(c) || /wget\s+.*\|\s*(sh|bash)/i.test(c) || /:\(\)\s*\{\s*:\|:&\s*\};:/i.test(c);
}

export async function toolShell({ command } = {}) {
  if (!command) throw new Error("shell precisa de command");
  const cmd = String(command);
  console.log(`\n${S("🔧", _.e)} ${S(cmd, _.b)}`);
  if (isDangerous(cmd)) console.log(S("⚠️  Comando perigoso detectado!", _.r, _.b));

  await fs.appendFile(SHELL_HISTORY, `${new Date().toISOString()}  ${cmd}\n`, "utf8").catch(() => {});

  const profile = PROFILES[state.currentProfile];
  if (profile.shell) {
    const ok = await confirm(S("Executar?", _.y));
    if (!ok) return { ok: false, cancelled: true };
  }

  try {
    const res = await execFileAsync("bash", ["-lc", cmd], {
      cwd: WORKSPACE, maxBuffer: 1024 * 1024, env: process.env, timeout: 120000,
    });
    return { ok: true, code: 0, stdout: clip(res.stdout || ""), stderr: clip(res.stderr || "") };
  } catch (err) {
    return { ok: false, code: err.code || 1, error: err.message, stderr: clip(err.stderr || "") };
  }
}

// ── Git tools ──
export async function toolGitStatus() {
  try { const r = await execFileAsync("git", ["status", "--short"], { cwd: WORKSPACE }); return { ok: true, status: r.stdout || "Limpo" }; }
  catch (err) { return { ok: false, error: err.message }; }
}

export async function toolGitDiff() {
  try { const r = await execFileAsync("git", ["diff"], { cwd: WORKSPACE }); return { ok: true, diff: clip(r.stdout || "Nenhuma mudança") }; }
  catch (err) { return { ok: false, error: err.message }; }
}

export async function toolGitCommit({ message } = {}) {
  if (!message) throw new Error("git commit precisa de message");
  try {
    await execFileAsync("git", ["add", "-A"], { cwd: WORKSPACE });
    const r = await execFileAsync("git", ["commit", "-m", String(message)], { cwd: WORKSPACE });
    return { ok: true, output: r.stdout };
  } catch (err) { return { ok: false, error: err.message }; }
}

export async function toolGitBranch({ name } = {}) {
  if (!name) throw new Error("git branch precisa de name");
  try { const r = await execFileAsync("git", ["checkout", "-b", String(name)], { cwd: WORKSPACE }); return { ok: true, output: r.stdout }; }
  catch (err) { return { ok: false, error: err.message }; }
}

export async function toolGitStash() {
  try { const r = await execFileAsync("git", ["stash"], { cwd: WORKSPACE }); return { ok: true, output: r.stdout || "Stashed" }; }
  catch (err) { return { ok: false, error: err.message }; }
}

export async function toolGitLog({ count = 10 } = {}) {
  try {
    const r = await execFileAsync("git", ["log", "--oneline", `-${count}`], { cwd: WORKSPACE });
    return { ok: true, log: r.stdout };
  } catch (err) { return { ok: false, error: err.message }; }
}

// ── Test runner (auto-detect framework) ──
export async function toolTest({ framework } = {}) {
  const fw = String(framework || "auto").toLowerCase();
  let cmd = "";
  if (fw === "auto") {
    if (await fExists(path.join(WORKSPACE, "package.json"))) cmd = "npm test";
    else if (await fExists(path.join(WORKSPACE, "Cargo.toml"))) cmd = "cargo test";
    else if (await fExists(path.join(WORKSPACE, "pytest.ini")) || await fExists(path.join(WORKSPACE, "setup.py"))) cmd = "python -m pytest";
    else if (await fExists(path.join(WORKSPACE, "go.mod"))) cmd = "go test ./...";
    else return { ok: false, error: "Framework não detectado" };
  } else if (["npm", "node", "jest"].includes(fw)) cmd = "npm test";
  else if (["pytest", "python"].includes(fw)) cmd = "python -m pytest";
  else if (["cargo", "rust"].includes(fw)) cmd = "cargo test";
  else return { ok: false, error: `Framework '${fw}' não suportado` };

  try {
    const r = await execFileAsync("bash", ["-lc", cmd], { cwd: WORKSPACE, maxBuffer: 1024 * 1024, timeout: 120000 });
    return { ok: true, code: 0, stdout: clip(r.stdout || ""), stderr: clip(r.stderr || "") };
  } catch (err) { return { ok: false, error: err.message, stderr: clip(err.stderr || "") }; }
}

// ── Docker tools ──
export async function toolDocker({ action, args = "" } = {}) {
  const cmd = `docker ${action} ${args}`.trim();
  console.log(S(`\n🐳 ${cmd}`, _.e, _.b));
  try {
    const r = await execFileAsync("bash", ["-lc", cmd], { cwd: WORKSPACE, maxBuffer: 1024 * 1024, timeout: 120000 });
    return { ok: true, stdout: clip(r.stdout || ""), stderr: clip(r.stderr || "") };
  } catch (err) { return { ok: false, error: err.message, stderr: clip(err.stderr || "") }; }
}

// ── Pipeline runner ──
export async function toolPipeline({ commands } = {}) {
  if (!commands || !Array.isArray(commands)) throw new Error("pipeline precisa de commands[]");
  let passed = 0;
  for (const cmd of commands) {
    console.log(S(`\n▶️ ${cmd}`, _.c));
    try {
      const r = await execFileAsync("bash", ["-lc", cmd], { cwd: WORKSPACE, maxBuffer: 1024 * 1024, timeout: 120000 });
      console.log(S("  ✅ OK", _.Gr));
      if (r.stdout) console.log(clip(r.stdout, 1000));
      passed++;
    } catch (err) {
      console.log(S(`  ❌ FAIL: ${err.message}`, _.r));
      return { ok: false, passed, total: commands.length, failedCmd: cmd };
    }
  }
  return { ok: true, passed, total: commands.length };
}

// ── Package manager ──
export async function toolPkg({ action, packages = [] } = {}) {
  let pm = "npm";
  if (await fExists(path.join(WORKSPACE, "pnpm-lock.yaml"))) pm = "pnpm";
  else if (await fExists(path.join(WORKSPACE, "yarn.lock"))) pm = "yarn";
  else if (await fExists(path.join(WORKSPACE, "bun.lockb"))) pm = "bun";

  const cmd = `${pm} ${action} ${packages.join(" ")}`.trim();
  console.log(S(`\n📦 ${cmd}`, _.e, _.b));
  try {
    const r = await execFileAsync("bash", ["-lc", cmd], { cwd: WORKSPACE, maxBuffer: 1024 * 1024, timeout: 120000 });
    return { ok: true, stdout: clip(r.stdout || ""), stderr: clip(r.stderr || "") };
  } catch (err) { return { ok: false, error: err.message, stderr: clip(err.stderr || "") }; }
}
