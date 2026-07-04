// ═══════════════════════════════════════════════════════════════════════════════
// BOX DRAWING & TABLE RENDERING (inspired by OpenCode TUI)
// ═══════════════════════════════════════════════════════════════════════════════

import { _, S, visLen } from "../core/ansi.js";

const H = "─", V = "│", TL = "┌", TR = "┐", BL = "└", BR = "┘", ML = "├", MR = "┤";
const DH = "═", DV = "║", DTL = "╔", DTR = "╗", DBL = "╚", DBR = "╝";

export function drawBox(lines, opts = {}) {
  const { title = "", color = _.c, w = 76, double = false } = opts;
  const iw = w - 2;
  const h = double ? DH : H;
  const v = double ? DV : V;
  const tl = double ? DTL : TL;
  const tr = double ? DTR : TR;
  const bl = double ? DBL : BL;
  const br = double ? DBR : BR;
  let out = "\n";

  if (title) {
    const t = ` ${title} `;
    const lw = Math.max(0, Math.floor((iw - visLen(t)) / 2));
    const rw = Math.max(0, iw - visLen(t) - lw);
    out += color + tl + h.repeat(lw) + _.b + t + _.x + color + h.repeat(rw) + tr + _.x + "\n";
  } else {
    out += color + tl + h.repeat(iw) + tr + _.x + "\n";
  }

  for (const line of lines) {
    const vis = visLen(line);
    const pad = Math.max(0, iw - vis);
    out += color + v + _.x + line + " ".repeat(pad) + color + v + _.x + "\n";
  }

  out += color + bl + h.repeat(iw) + br + _.x + "\n";
  return out;
}

export function drawTable(rows, opts = {}) {
  const { title = "", color = _.c, w = 76 } = opts;
  const iw = w - 2;
  let out = "\n";

  if (title) {
    const t = ` ${title} `;
    const lw = Math.max(0, Math.floor((iw - visLen(t)) / 2));
    const rw = Math.max(0, iw - visLen(t) - lw);
    out += color + TL + H.repeat(lw) + _.b + t + _.x + color + H.repeat(rw) + TR + _.x + "\n";
  } else {
    out += color + TL + H.repeat(iw) + TR + _.x + "\n";
  }

  for (let i = 0; i < rows.length; i++) {
    const [k, v] = rows[i];
    const line = `  ${S(k, color, _.b)}  ${v}`;
    const vis = visLen(line);
    const pad = Math.max(0, iw - vis);
    out += color + V + _.x + line + " ".repeat(pad) + color + V + _.x + "\n";
    if (i < rows.length - 1) out += color + ML + H.repeat(iw) + MR + _.x + "\n";
  }

  out += color + BL + H.repeat(iw) + BR + _.x + "\n";
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIALOG SYSTEM (inspired by OpenCode dialogs)
// Renders an interactive list/selector that looks like a floating window
// ═══════════════════════════════════════════════════════════════════════════════

export function drawSelector(items, opts = {}) {
  const { title = "", color = _.c, w = 60, selected = -1, hint = "" } = opts;
  const iw = w - 2;
  const lines = items.map((item, i) => {
    const prefix = i === selected ? S(" ▸ ", _.Gr, _.b) : "   ";
    const label = i === selected ? S(item.label, _.W, _.b) : S(item.label, _.w);
    const desc = item.desc ? S(` ${item.desc}`, _.G) : "";
    return prefix + label + desc;
  });
  if (hint) lines.push("", S(`  ${hint}`, _.d, _.i));
  return drawBox(lines, { title, color, w });
}

export function drawProgressBar(current, total, width = 30) {
  const pct = Math.min(1, current / total);
  const filled = Math.floor(width * pct);
  return S("[", _.G) + S("█".repeat(filled), _.g) + S("░".repeat(width - filled), _.d) + S("]", _.G) + S(` ${Math.floor(pct * 100)}%`, _.w);
}

// Spinner
const SPIN_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPIN_COLS = [_.c, _.e, _.m, _.e];
let spinInt = null, spinFrm = 0, spinStart = 0;

export function startSpin(text = "Pensando") {
  if (spinInt) return;
  spinFrm = 0; spinStart = Date.now();
  spinInt = setInterval(() => {
    const col = SPIN_COLS[Math.floor(spinFrm / 3) % SPIN_COLS.length];
    const elapsed = (Date.now() - spinStart);
    const durStr = elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`;
    process.stdout.write(`\r${col}${SPIN_CHARS[spinFrm]}${_.x} ${S(text, _.d)}... ${S(durStr, _.G)}`);
    spinFrm = (spinFrm + 1) % SPIN_CHARS.length;
  }, 80);
}

export function stopSpin() {
  if (spinInt) {
    clearInterval(spinInt);
    spinInt = null;
    process.stdout.write("\r" + " ".repeat(80) + "\r");
  }
}
