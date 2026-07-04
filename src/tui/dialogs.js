// ═══════════════════════════════════════════════════════════════════════════════
// INTERACTIVE DIALOGS — v0.0.12
// Multi-page selector with search, pagination, categories
// Safe readline-based (no raw mode = no Termux crashes)
// ═══════════════════════════════════════════════════════════════════════════════

import readline from "node:readline";
import { _, S } from "../core/ansi.js";

/**
 * Interactive paginated list selector
 * 
 * Features:
 * - Numbered items — type number to select
 * - Type text to fuzzy search/filter
 * - "n" for next page, "p" for previous
 * - Categories shown with headers
 * - Enter alone = cancel
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

    // Header
    console.log("");
    console.log(S(`  ● ${title}`, _.c, _.b) + (searchTerm ? S(` — filter: "${searchTerm}"`, _.y) : "") + S(` (${filtered.length} items)`, _.G));
    console.log(S("  ─".repeat(30), _.d));

    // Items
    for (let i = 0; i < pageItems.length; i++) {
      const item = pageItems[i];
      const num = S(String(start + i + 1).padStart(3), _.y);
      const label = S(item.label, _.w, _.b);
      const desc = item.desc ? S(` ${item.desc}`, _.G) : "";
      const tag = item.tag ? S(` [${item.tag}]`, _.Gr) : "";
      console.log(`  ${num}  ${label}${desc}${tag}`);
    }

    // Footer
    console.log(S("  ─".repeat(30), _.d));
    const hints = [];
    hints.push(S("#", _.y) + S(" select", _.G));
    hints.push(S("text", _.y) + S(" filter", _.G));
    if (totalPages > 1) {
      hints.push(S("n", _.y) + S(" next", _.G));
      hints.push(S("p", _.y) + S(" prev", _.G));
    }
    if (searchTerm) hints.push(S("c", _.y) + S(" clear", _.G));
    hints.push(S("enter", _.y) + S(" cancel", _.G));
    console.log("  " + hints.join(S(" · ", _.d)));
    if (totalPages > 1) console.log(S(`  page ${page + 1}/${totalPages}`, _.d));

    // Input
    const answer = await textInput(S("  > ", _.g));
    const input = answer.trim();

    // Cancel
    if (!input) return null;

    // Navigation
    if (input === "n" && page < totalPages - 1) { page++; continue; }
    if (input === "p" && page > 0) { page--; continue; }
    if (input === "c") { searchTerm = ""; filtered = [...items]; page = 0; continue; }

    // Number selection
    const num = parseInt(input);
    if (!isNaN(num) && num >= 1 && num <= filtered.length) {
      return filtered[num - 1];
    }

    // Search/filter
    searchTerm = input;
    const lower = input.toLowerCase();
    filtered = items.filter(it =>
      it.label.toLowerCase().includes(lower) ||
      (it.id || "").toLowerCase().includes(lower) ||
      (it.desc || "").toLowerCase().includes(lower)
    );
    page = 0;

    if (filtered.length === 0) {
      console.log(S("  nenhum resultado", _.r));
      searchTerm = "";
      filtered = [...items];
    } else if (filtered.length === 1) {
      // Auto-select single result
      return filtered[0];
    }
  }
}

/**
 * Confirmation dialog
 */
export async function confirm(message, defaultYes = false) {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await textInput(`${message} ${S(suffix, _.G)} `);
  const a = answer.trim().toLowerCase();
  if (!a) return defaultYes;
  return a === "y" || a === "yes";
}

/**
 * Text input
 */
export async function textInput(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => { rl.close(); resolve(answer); });
  });
}
