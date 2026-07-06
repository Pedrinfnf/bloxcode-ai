// ═══════════════════════════════════════════════════════════════════════════════
// INTERACTIVE DIALOGS — v0.0.14
// Uses a SHARED readline reference to avoid stdin corruption on Termux
// ═══════════════════════════════════════════════════════════════════════════════

import readline from "node:readline";
import { _, S } from "../core/ansi.js";

// ── Shared readline ref — set by main loop, used by all dialogs ──
let _sharedRl = null;

export function setSharedReadline(rl) {
  _sharedRl = rl;
}

/**
 * Ask a question using the SHARED readline (safe, no stdin corruption)
 * Falls back to creating a temporary one if no shared rl
 */
function ask(prompt) {
  return new Promise((resolve) => {
    if (_sharedRl) {
      // Use shared — just ask, don't close
      _sharedRl.question(prompt, (answer) => resolve(answer));
    } else {
      // Fallback — create temporary (risky on Termux but better than nothing)
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(prompt, (answer) => { rl.close(); resolve(answer); });
    }
  });
}

/**
 * Interactive paginated list selector
 */
export async function selectFromList(items, opts = {}) {
  const { title = "Select", perPage = 15 } = opts;
  if (!items.length) return null;

  let filtered = [...items];
  let page = 0;
  let searchTerm = "";

  while (true) {
    const totalPages = Math.ceil(filtered.length / perPage);
    const start = page * perPage;
    const pageItems = filtered.slice(start, start + perPage);

    console.log("");
    console.log(S(`  ● ${title}`, _.c, _.b) + (searchTerm ? S(` — "${searchTerm}"`, _.y) : "") + S(` (${filtered.length})`, _.G));
    console.log(S("  " + "─".repeat(58), _.d));

    for (let i = 0; i < pageItems.length; i++) {
      const item = pageItems[i];
      const num = S(String(start + i + 1).padStart(3), _.y);
      const label = S(item.label, _.w, _.b);
      const desc = item.desc ? S(` ${item.desc}`, _.G) : "";
      const tag = item.tag ? S(` [${item.tag}]`, _.Gr) : "";
      console.log(`  ${num}  ${label}${desc}${tag}`);
    }

    console.log(S("  " + "─".repeat(58), _.d));
    const hints = [S("#", _.y) + S("select", _.G), S("text", _.y) + S("filter", _.G)];
    if (totalPages > 1) { hints.push(S("n", _.y) + S("ext", _.G)); hints.push(S("p", _.y) + S("rev", _.G)); }
    if (searchTerm) hints.push(S("c", _.y) + S("lear", _.G));
    console.log("  " + hints.join(S(" · ", _.d)));
    if (totalPages > 1) console.log(S(`  page ${page + 1}/${totalPages}`, _.d));

    const input = (await ask(S("  > ", _.g))).trim();
    if (!input) return null;

    if (input === "n" && page < totalPages - 1) { page++; continue; }
    if (input === "p" && page > 0) { page--; continue; }
    if (input === "c") { searchTerm = ""; filtered = [...items]; page = 0; continue; }

    const num = parseInt(input);
    if (!isNaN(num) && num >= 1 && num <= filtered.length) return filtered[num - 1];

    searchTerm = input;
    const lower = input.toLowerCase();
    filtered = items.filter(it =>
      it.label.toLowerCase().includes(lower) ||
      (it.id || "").toLowerCase().includes(lower) ||
      (it.desc || "").toLowerCase().includes(lower)
    );
    page = 0;

    if (filtered.length === 0) { console.log(S("  no results", _.r)); searchTerm = ""; filtered = [...items]; }
    else if (filtered.length === 1) return filtered[0];
  }
}

/**
 * Confirmation — uses shared readline
 */
export async function confirm(message, defaultYes = false) {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const a = (await ask(`${message} ${S(suffix, _.G)} `)).trim().toLowerCase();
  if (!a) return defaultYes;
  return a === "y" || a === "yes";
}

/**
 * Text input — uses shared readline
 */
export async function textInput(prompt) {
  return await ask(prompt);
}
