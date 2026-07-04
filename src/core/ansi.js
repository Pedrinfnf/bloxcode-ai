// ═══════════════════════════════════════════════════════════════════════════════
// ANSI PALETTE & TEXT UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

export const _ = {
  x: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", i: "\x1b[3m", u: "\x1b[4m",
  k: "\x1b[30m", r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", e: "\x1b[34m",
  m: "\x1b[35m", c: "\x1b[36m", w: "\x1b[37m", G: "\x1b[90m",
  R: "\x1b[91m", Gr: "\x1b[92m", Y: "\x1b[93m", B: "\x1b[94m", M: "\x1b[95m", C: "\x1b[96m", W: "\x1b[97m",
  bgG: "\x1b[42m", bgE: "\x1b[44m", bgM: "\x1b[45m", bgC: "\x1b[46m",
  bgR: "\x1b[41m", bgY: "\x1b[43m", bgW: "\x1b[47m",
};

export function S(txt, ...codes) {
  return codes.join("") + String(txt) + _.x;
}

export function stripAnsi(s) {
  return String(s).replace(/\x1b\[\d+m/g, "");
}

export function visLen(s) {
  return stripAnsi(s).length;
}

export function clip(text, max = 12000) {
  const s = String(text || "");
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... (cortado, ${s.length - max} chars restantes)`;
}

export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

export function formatBytes(b) {
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1048576).toFixed(1)}MB`;
}

export function notify() {
  try { process.stdout.write("\x07"); } catch {}
}
