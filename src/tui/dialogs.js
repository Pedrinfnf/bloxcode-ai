// ═══════════════════════════════════════════════════════════════════════════════
// INTERACTIVE DIALOGS — v4.2.2
// Fixed: no longer kills stdin after selection (was crashing the main REPL)
// ═══════════════════════════════════════════════════════════════════════════════

import readline from "node:readline";
import { _, S } from "../core/ansi.js";
import { drawBox } from "./box.js";

/**
 * Interactive list selector — arrow keys + search
 * FIXED: doesn't pause stdin on cleanup (that killed the main readline)
 */
export async function selectFromList(items, opts = {}) {
  const { title = "Select", hint = "↑↓ navigate · Enter select · Esc cancel", w = 64, maxVisible = 12, filter = true } = opts;

  if (!items.length) return null;

  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    let selected = 0;
    let scroll = 0;
    let searchText = "";
    let filtered = [...items];
    let wasRaw = false;

    function getFiltered() {
      if (!searchText) return [...items];
      const lower = searchText.toLowerCase();
      return items.filter(it =>
        it.label.toLowerCase().includes(lower) ||
        (it.desc || "").toLowerCase().includes(lower) ||
        (it.id || "").toLowerCase().includes(lower)
      );
    }

    function render() {
      const visible = filtered.slice(scroll, scroll + maxVisible);
      const lines = [];

      if (filter) {
        lines.push(S(`  🔍 ${searchText || "Type to filter..."}`, searchText ? _.w : _.G));
        lines.push(S("  " + "─".repeat(w - 6), _.d));
      }

      for (let i = 0; i < visible.length; i++) {
        const globalIdx = scroll + i;
        const item = visible[i];
        const isSelected = globalIdx === selected;
        const pointer = isSelected ? S(" ▸ ", _.Gr, _.b) : "   ";
        const label = isSelected ? S(item.label, _.W, _.b) : S(item.label, _.w);
        const desc = item.desc ? S(` ${item.desc}`, _.G) : "";
        const tag = item.tag ? S(` [${item.tag}]`, _.c) : "";
        lines.push(pointer + label + desc + tag);
      }

      if (filtered.length > maxVisible) {
        const pct = Math.floor((scroll / Math.max(1, filtered.length - maxVisible)) * 100);
        lines.push(S(`  ── ${filtered.length} items · ${pct}% ──`, _.d));
      }

      lines.push("", S(`  ${hint}`, _.d, _.i));

      stdout.write(`\x1b[${maxVisible + 8}A\x1b[J`);
      stdout.write(drawBox(lines, { title: S(title, _.c, _.b), color: _.c, w }));
    }

    // Save raw mode state and enable it
    try { wasRaw = stdin.isRaw; } catch { wasRaw = false; }
    stdout.write("\n".repeat(maxVisible + 8));
    render();

    if (stdin.isTTY) {
      try { stdin.setRawMode(true); } catch {}
    }

    function onKey(raw) {
      const key = typeof raw === "string" ? raw : raw.toString();

      if (key === "\x1b" || key === "\x03") { cleanup(); resolve(null); return; }
      if (key === "\r" || key === "\n") { cleanup(); resolve(filtered[selected] || null); return; }

      // Arrow Up / Page Up
      if (key.includes("\x1b[A") || key === "\x1b[5~") {
        selected = Math.max(0, selected - 1);
        if (selected < scroll) scroll = selected;
        render(); return;
      }

      // Arrow Down / Page Down
      if (key.includes("\x1b[B") || key === "\x1b[6~") {
        selected = Math.min(filtered.length - 1, selected + 1);
        if (selected >= scroll + maxVisible) scroll = selected - maxVisible + 1;
        render(); return;
      }

      // Backspace
      if (key === "\x7f" || key === "\b") {
        if (searchText.length > 0) {
          searchText = searchText.slice(0, -1);
          filtered = getFiltered();
          selected = 0; scroll = 0;
          render();
        }
        return;
      }

      // Printable chars
      if (filter && key.length === 1 && key.charCodeAt(0) >= 32) {
        searchText += key;
        filtered = getFiltered();
        selected = 0; scroll = 0;
        render();
      }
    }

    function cleanup() {
      stdin.removeListener("data", onKey);
      // CRITICAL: restore raw mode to what it was before, do NOT pause stdin
      if (stdin.isTTY) {
        try { stdin.setRawMode(wasRaw); } catch {}
      }
      // Do NOT call stdin.pause() — that kills the main readline!
    }

    stdin.on("data", onKey);
  });
}

/**
 * Simple confirmation dialog
 */
export async function confirm(message, defaultYes = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  return new Promise((resolve) => {
    rl.question(`${message} ${S(suffix, _.G)} `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (!a) resolve(defaultYes);
      else resolve(a === "y" || a === "yes");
    });
  });
}

/**
 * Text input dialog
 */
export async function textInput(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
