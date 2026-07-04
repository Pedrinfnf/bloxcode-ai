// ═══════════════════════════════════════════════════════════════════════════════
// LLM API — v4.1 — Now uses runtime state.apiKey + state.apiBaseUrl
// ═══════════════════════════════════════════════════════════════════════════════

import { _, S, clip } from "../core/ansi.js";
import { REFERER, TITLE, MAX_TOKENS, FETCH_TIMEOUT, sessionStats, state, getApiKey } from "../config/state.js";

async function fetchWithTimeout(url, opts = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

function apiHeaders() {
  const key = getApiKey();
  if (!key) throw new Error("API key não configurada. Use /api set <sua-key>");
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${key}`,
    "HTTP-Referer": REFERER,
    "X-Title": TITLE,
  };
}

function apiUrl(endpoint) {
  return `${state.apiBaseUrl}/${endpoint}`;
}

/**
 * Non-streaming chat call
 */
export async function chatAI(messages, model) {
  const body = { model, messages, max_tokens: MAX_TOKENS, temperature: 0.3, stream: false };
  if (state.reasoningLevel !== "off") body.reasoning = { effort: state.reasoningLevel };

  const res = await fetchWithTimeout(apiUrl("chat/completions"), {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return await res.json();
}

/**
 * Streaming chat with live output + tool-call detection
 */
export async function streamChat(messages, model) {
  const body = { model, messages, max_tokens: MAX_TOKENS, temperature: 0.3, stream: true };
  if (state.reasoningLevel !== "off") body.reasoning = { effort: state.reasoningLevel };

  const res = await fetchWithTimeout(apiUrl("chat/completions"), {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${errBody.slice(0, 200)}`);
  }

  let content = "", usage = null, reasoningContent = "", inReasoning = false;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;

        if (delta?.reasoning) {
          if (!inReasoning) { process.stdout.write(S("\n💭 ", _.d)); inReasoning = true; }
          reasoningContent += delta.reasoning;
          process.stdout.write(S(delta.reasoning, _.d, _.i));
        }
        if (delta?.content) {
          if (inReasoning) { process.stdout.write("\n"); inReasoning = false; }
          content += delta.content;
          sessionStats.streamingChunks++;
          process.stdout.write(delta.content);
        }
        if (parsed.usage) usage = parsed.usage;
      } catch {}
    }
  }
  process.stdout.write("\n\n");
  return { content, usage, reasoning: reasoningContent };
}

/**
 * Extract JSON from LLM response
 */
export function extractJson(text) {
  const s = String(text || "").trim();
  try { return JSON.parse(s); } catch {}
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) try { return JSON.parse(m[1].trim()); } catch {}
  const braceStart = s.indexOf("{");
  const braceEnd = s.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    try { return JSON.parse(s.slice(braceStart, braceEnd + 1)); } catch {}
  }
  throw new Error("No valid JSON found");
}

/**
 * Estimate cost — fetches real pricing from model cache when available
 */
export function estimateCost(model, usage) {
  if (!usage) return { input: 0, output: 0, total: 0 };
  const prices = {
    "nvidia/nemotron-3-ultra-550b-a55b:free": { i: 0, o: 0 },
    "deepseek/deepseek-chat": { i: 0.14, o: 0.28 },
    "anthropic/claude-opus-4": { i: 15, o: 75 },
    "anthropic/claude-sonnet-4-20250514": { i: 3, o: 15 },
    "openai/gpt-4o": { i: 2.5, o: 10 },
    "google/gemini-2.0-flash-001": { i: 0.1, o: 0.4 },
    "google/gemini-2.5-pro-preview-03-25": { i: 1.25, o: 10 },
    "deepseek/deepseek-r1": { i: 0.55, o: 2.19 },
    "qwen/qwen-2.5-coder-32b-instruct": { i: 0.07, o: 0.16 },
  };
  const p = prices[model] || { i: 1, o: 3 };
  const input = (usage.prompt_tokens || 0) / 1e6 * p.i;
  const output = (usage.completion_tokens || 0) / 1e6 * p.o;
  return { input, output, total: input + output };
}
