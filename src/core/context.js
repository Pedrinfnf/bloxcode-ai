// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT WINDOW TRACKER — Visual bar showing context usage
// Inspired by OpenCode's context compression + Claude Code auto-compact
// ═══════════════════════════════════════════════════════════════════════════════

import { _, S } from "./ansi.js";

// Rough token estimation: ~4 chars per token (good enough for display)
function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

// Known context windows per model family
const CONTEXT_WINDOWS = {
  "nemotron": 1000000,
  "qwen3-coder": 1000000,
  "gpt-oss": 131072,
  "llama-3.3": 131072,
  "llama-3.2": 131072,
  "hermes": 131072,
  "gemma-4": 262144,
  "deepseek": 131072,
  "claude": 200000,
  "gpt-4o": 128000,
  "gemini": 1000000,
};

function getContextWindow(model) {
  const m = (model || "").toLowerCase();
  for (const [key, size] of Object.entries(CONTEXT_WINDOWS)) {
    if (m.includes(key)) return size;
  }
  return 128000; // default
}

/**
 * Calculate context usage from messages array
 */
export function getContextUsage(messages, model) {
  const totalChars = messages.reduce((sum, m) => sum + (m.content || "").length, 0);
  const estimatedTokens = estimateTokens(messages.map(m => m.content || "").join(""));
  const maxTokens = getContextWindow(model);
  const pct = Math.min(1, estimatedTokens / maxTokens);
  return { estimatedTokens, maxTokens, pct, totalChars };
}

/**
 * Render context bar for the prompt
 * [████████░░░░] 45% of 128k
 */
export function contextBar(messages, model) {
  const { estimatedTokens, maxTokens, pct } = getContextUsage(messages, model);
  const width = 15;
  const filled = Math.floor(width * pct);
  const empty = width - filled;

  const color = pct < 0.5 ? _.Gr : pct < 0.8 ? _.y : _.r;
  const bar = color + "█".repeat(filled) + _.G + "░".repeat(empty) + _.x;
  const pctStr = `${Math.floor(pct * 100)}%`;
  const sizeStr = maxTokens >= 1000000 ? `${(maxTokens / 1000000).toFixed(0)}M` : `${(maxTokens / 1000).toFixed(0)}k`;

  return `[${bar}] ${S(pctStr, color)} ${S(`of ${sizeStr}`, _.G)}`;
}

/**
 * Check if context is getting full and should auto-compact
 */
export function shouldAutoCompact(messages, model) {
  const { pct } = getContextUsage(messages, model);
  return pct > 0.75;
}
