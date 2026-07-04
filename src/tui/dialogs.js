// ═══════════════════════════════════════════════════════════════════════════════
// INTERACTIVE DIALOGS (inspired by OpenCode's TUI dialogs)
// Model selector, session picker, theme picker, etc.
// Uses raw terminal mode for arrow-key navigation like OpenCode/Pi
// ═══════════════════════════════════════════════════════════════════════════════

import readline from "node:readline";
import { _, S } from "../core/ansi.js";
import { drawBox } from "./box.js";

/**
 * Interactive list selector — renders a scrollable, navigable list in terminal
 * Similar to OpenCode's /model dialog and Pi's /model Ctrl+L popup
 */
export async function selectFromList(items, opts = {}) {
  const { title = "Select", hint = "↑↓ navigate · Enter select · Esc cancel", w = 64, maxVisible = 12, filter = true } = opts;
  
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    let selected = 0;
    let scroll = 0;
    let searchText = "";
    let filtered = [...items];

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

      // Search bar
      if (filter) {
        lines.push(S(`  🔍 ${searchText || "Type to filter..."}`, searchText ? _.w : _.G));
        lines.push(S("  " + "─".repeat(w - 6), _.d));
      }

      // Items
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

      // Scroll indicator
      if (filtered.length > maxVisible) {
        const pct = Math.floor((scroll / Math.max(1, filtered.length - maxVisible)) * 100);
        lines.push(S(`  ── ${filtered.length} items · ${pct}% ──`, _.d));
      }

      // Hint
      lines.push("", S(`  ${hint}`, _.d, _.i));

      // Clear previous render and draw
      stdout.write(`\x1b[${maxVisible + 8}A\x1b[J`);
      stdout.write(drawBox(lines, { title: S(title, _.c, _.b), color: _.c, w }));
    }

    // Initial render space
    stdout.write("\n".repeat(maxVisible + 8));
    render();

    // Enable raw mode
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();

    function onKey(raw) {
      const key = typeof raw === "string" ? raw : raw.toString();
      // Esc or Ctrl+C
      if (key === "\x1b" || key === "\x03") {
        cleanup();
        resolve(null);
        return;
      }

      // Enter
      if (key === "\r" || key === "\n") {
        cleanup();
        resolve(filtered[selected] || null);
        return;
      }

      // Arrow Up
      if (key === "\x1b[A" || key === "\x1b[5~") {
        selected = Math.max(0, selected - 1);
        if (selected < scroll) scroll = selected;
        render();
        return;
      }

      // Arrow Down
      if (key === "\x1b[B" || key === "\x1b[6~") {
        selected = Math.min(filtered.length - 1, selected + 1);
        if (selected >= scroll + maxVisible) scroll = selected - maxVisible + 1;
        render();
        return;
      }

      // Backspace
      if (key === "\x7f" || key === "\b") {
        if (searchText.length > 0) {
          searchText = searchText.slice(0, -1);
          filtered = getFiltered();
          selected = 0;
          scroll = 0;
          render();
        }
        return;
      }

      // Printable chars — filter
      if (filter && key.length === 1 && key.charCodeAt(0) >= 32) {
        searchText += key;
        filtered = getFiltered();
        selected = 0;
        scroll = 0;
        render();
      }
    }

    function cleanup() {
      stdin.removeListener("data", onKey);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
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
