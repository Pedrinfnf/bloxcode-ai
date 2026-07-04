// ═══════════════════════════════════════════════════════════════════════════════
// INPUT PROCESSOR — @ file references, ! shell shortcuts, smart parsing
// Inspired by Claude Code & Pi's @ file references and ! shell commands
// ═══════════════════════════════════════════════════════════════════════════════

import path from "node:path";
import fs from "node:fs/promises";
import { _, S } from "./ansi.js";
import { WORKSPACE, MAX_FILE_CHARS } from "../config/state.js";
import { getFileCache } from "../tools/files.js";

/**
 * Process @ file references in user input
 * e.g. "@src/index.js fix the bug on line 42"
 * → reads the file and prepends content to the message
 * 
 * Supports multiple @ references:
 * "@src/a.js @src/b.js compare these files"
 */
export async function processFileRefs(input) {
  const refPattern = /@([\w.\/\-]+)/g;
  const refs = [];
  let match;

  while ((match = refPattern.exec(input)) !== null) {
    refs.push(match[1]);
  }

  if (!refs.length) return { text: input, attachments: [] };

  const attachments = [];
  let cleanInput = input;

  for (const ref of refs) {
    // Fuzzy match against file cache
    const files = await getFileCache();
    const exact = files.find(f => f === ref || f.endsWith(ref));
    const fuzzy = exact || files.find(f => f.toLowerCase().includes(ref.toLowerCase()));

    if (fuzzy) {
      try {
        const fullPath = path.join(WORKSPACE, fuzzy);
        const content = await fs.readFile(fullPath, "utf8");
        const truncated = content.length > MAX_FILE_CHARS
          ? content.slice(0, MAX_FILE_CHARS) + `\n... (${content.length - MAX_FILE_CHARS} chars truncated)`
          : content;
        attachments.push({ path: fuzzy, content: truncated });
        cleanInput = cleanInput.replace(`@${ref}`, "").trim();
        console.log(S(`  📎 ${fuzzy} (${content.length} chars)`, _.d));
      } catch {
        console.log(S(`  ⚠️ @${ref} — não encontrado`, _.y));
      }
    } else {
      console.log(S(`  ⚠️ @${ref} — nenhum arquivo correspondente`, _.y));
    }
  }

  return { text: cleanInput, attachments };
}

/**
 * Process ! shell shortcut in user input
 * e.g. "!npm test" → runs command and returns output
 * "!!npm test" → runs but doesn't add to context
 */
export function isShellShortcut(input) {
  return input.startsWith("!");
}

export function getShellCommand(input) {
  const silent = input.startsWith("!!");
  const cmd = input.slice(silent ? 2 : 1).trim();
  return { cmd, silent };
}

/**
 * Build enriched message with file attachments
 */
export function buildMessageWithAttachments(text, attachments) {
  if (!attachments.length) return text;
  const fileContext = attachments.map(a =>
    `### File: ${a.path}\n\`\`\`\n${a.content}\n\`\`\``
  ).join("\n\n");
  return `${fileContext}\n\n${text}`;
}
