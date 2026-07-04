// ═══════════════════════════════════════════════════════════════════════════════
// INTERACTIVE DIALOGS — v4.3.3
// Rewritten: uses readline interface instead of raw mode to avoid killing stdin
// ═══════════════════════════════════════════════════════════════════════════════

import readline from "node:readline";
import { _, S } from "../core/ansi.js";
import { drawBox } from "./box.js";

/**
 * Interactive list selector — simple numbered list approach
 * No raw mode = no stdin corruption = no crashes
 */
export async function selectFromList(items, opts = {}) {
  const { title = "Select", w = 64, maxVisible = 20, filter = true } = opts;

  if (!items.length) return null;

  // Show the list
  console.log("");
  const displayItems = items.slice(0, maxVisible);
  const lines = displayItems.map((item, i) => {
    const num = S(String(i + 1).padStart(3), _.y, _.b);
    const label = S(item.label, _.w);
    const desc = item.desc ? S(` ${item.desc}`, _.G) : "";
    const tag = item.tag ? S(` [${item.tag}]`, _.c) : "";
    return `  ${num}  ${label}${desc}${tag}`;
  });

  if (items.length > maxVisible) {
    lines.push(S(`  ... +${items.length - maxVisible} mais`, _.d));
  }
  lines.push("");
  lines.push(S("  Digite o número, nome pra filtrar, ou Enter pra cancelar", _.d, _.i));

  console.log(drawBox(lines, { title: S(title, _.c, _.b), color: _.c, w }));

  // Ask for selection
  const answer = await textInput(S("  > ", _.g));
  const trimmed = answer.trim();

  if (!trimmed) return null;

  // Try as number
  const num = parseInt(trimmed);
  if (!isNaN(num) && num >= 1 && num <= displayItems.length) {
    return displayItems[num - 1];
  }

  // Try as filter/search
  const lower = trimmed.toLowerCase();
  const matches = items.filter(it =>
    it.label.toLowerCase().includes(lower) ||
    (it.id || "").toLowerCase().includes(lower) ||
    (it.desc || "").toLowerCase().includes(lower)
  );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    // Show filtered results and ask again
    console.log(S(`\n  ${matches.length} resultados:`, _.c));
    matches.slice(0, 10).forEach((m, i) => {
      console.log(`  ${S(String(i + 1).padStart(3), _.y)} ${S(m.label, _.w)} ${S(m.desc || "", _.G)}`);
    });
    const answer2 = await textInput(S("  > ", _.g));
    const num2 = parseInt(answer2.trim());
    if (!isNaN(num2) && num2 >= 1 && num2 <= matches.length) {
      return matches[num2 - 1];
    }
    // Try exact match on typed text
    const exact = matches.find(m => m.label.toLowerCase() === answer2.trim().toLowerCase() || m.id === answer2.trim());
    return exact || null;
  }

  return null;
}

/**
 * Simple confirmation dialog
 */
export async function confirm(message, defaultYes = false) {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await textInput(`${message} ${S(suffix, _.G)} `);
  const a = answer.trim().toLowerCase();
  if (!a) return defaultYes;
  return a === "y" || a === "yes";
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
