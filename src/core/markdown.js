// ═══════════════════════════════════════════════════════════════════════════════
// MARKDOWN RENDERER — Terminal markdown with ANSI colors
// Renders: headers, bold, italic, code blocks, inline code, lists, links
// ═══════════════════════════════════════════════════════════════════════════════

import { _, S } from "./ansi.js";

export function renderMarkdown(text) {
  const lines = String(text || "").split("\n");
  const out = [];
  let inCodeBlock = false;
  let codeLang = "";

  for (const line of lines) {
    // Code block toggle
    if (line.trimStart().startsWith("```")) {
      if (!inCodeBlock) {
        codeLang = line.trim().slice(3).trim();
        out.push(S(`  ┌─ ${codeLang || "code"} ${"─".repeat(Math.max(0, 50 - (codeLang || "code").length))}`, _.d));
        inCodeBlock = true;
      } else {
        out.push(S(`  └${"─".repeat(55)}`, _.d));
        inCodeBlock = false;
        codeLang = "";
      }
      continue;
    }

    if (inCodeBlock) {
      out.push(S("  │ ", _.d) + S(line, _.Gr));
      continue;
    }

    // Headers
    if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^(#+)/)[1].length;
      const text = line.replace(/^#+\s*/, "");
      const colors = [_.c, _.c, _.y, _.m, _.e, _.G];
      const prefix = level <= 2 ? "\n" : "";
      const underline = level === 1 ? "\n" + S("═".repeat(Math.min(60, text.length + 4)), colors[0]) : "";
      out.push(prefix + S(`${"#".repeat(level)} ${text}`, colors[level - 1] || _.w, _.b) + underline);
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      out.push(S("─".repeat(60), _.d));
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s/.test(line)) {
      const indent = line.match(/^(\s*)/)[1];
      const content = line.replace(/^\s*[-*+]\s/, "");
      out.push(indent + S("  • ", _.c) + renderInline(content));
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s/.test(line)) {
      const indent = line.match(/^(\s*)/)[1];
      const num = line.match(/(\d+)\./)[1];
      const content = line.replace(/^\s*\d+\.\s/, "");
      out.push(indent + S(`  ${num}. `, _.y) + renderInline(content));
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      out.push(S("  ▎ ", _.e) + S(line.replace(/^>\s?/, ""), _.d, _.i));
      continue;
    }

    // Regular line with inline formatting
    out.push(renderInline(line));
  }

  return out.join("\n");
}

function renderInline(text) {
  return text
    // Bold + italic
    .replace(/\*\*\*(.*?)\*\*\*/g, (_, t) => S(t, _.W, _.b, _.i))
    // Bold
    .replace(/\*\*(.*?)\*\*/g, (_, t) => S(t, _.W, _.b))
    // Italic
    .replace(/\*(.*?)\*/g, (_, t) => S(t, _.w, _.i))
    // Inline code
    .replace(/`([^`]+)`/g, (_, t) => S(t, _.Gr, _.d))
    // Links [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => S(text, _.c, _.u) + S(` (${url})`, _.d))
    // Strikethrough
    .replace(/~~(.*?)~~/g, (_, t) => S(t, _.G));
}
