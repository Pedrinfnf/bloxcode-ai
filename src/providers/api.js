// ═══════════════════════════════════════════════════════════════════════════════
// LLM API — v4.2.2 — Properly handles models that leak thinking into content
// Qwen3 Coder, DeepSeek R1, etc send reasoning inside content field
// ═══════════════════════════════════════════════════════════════════════════════

import { _, S, clip } from "../core/ansi.js";
import { REFERER, TITLE, MAX_TOKENS, FETCH_TIMEOUT, sessionStats, state, getApiKey } from "../config/state.js";
import { stopSpin } from "../tui/box.js";

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

// Models that send thinking/reasoning inside the content field
const THINKING_IN_CONTENT_MODELS = [
  "qwen/qwen3-coder",
  "deepseek/deepseek-r1",
  "liquid/lfm-2.5-1.2b-thinking",
];

function modelLeaksThinking(model) {
  return THINKING_IN_CONTENT_MODELS.some(m => model.startsWith(m));
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
 * Streaming chat
 * 
 * For models that leak thinking into content (Qwen3 Coder, DeepSeek R1):
 *   - Buffers ALL content silently (no live streaming)
 *   - Strips <think>...</think> blocks
 *   - Shows only the clean response at the end
 * 
 * For normal models:
 *   - Streams content live as tokens arrive
 *   - Shows reasoning in 💭 block if /reasoning is enabled
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

  const leaksThinking = modelLeaksThinking(model);
  let rawContent = "";       // All content tokens accumulated
  let reasoningContent = "";  // Reasoning tokens (from reasoning field)
  let usage = null;

  // For non-leaking models: stream display state
  let firstContentToken = true;
  let inReasoningBlock = false;
  const showReasoning = state.reasoningLevel !== "off";

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

        // ── Handle dedicated reasoning field ──
        const reasoningText = delta?.reasoning || delta?.reasoning_content || "";
        if (reasoningText) {
          reasoningContent += reasoningText;
          if (showReasoning && !leaksThinking) {
            if (!inReasoningBlock) {
              stopSpin();
              process.stdout.write(S("\n💭 ", _.d));
              inReasoningBlock = true;
            }
            process.stdout.write(S(reasoningText, _.d, _.i));
          }
          continue;
        }

        // ── Handle content ──
        if (delta?.content) {
          rawContent += delta.content;
          sessionStats.streamingChunks++;

          // For leaking models: DON'T stream — just accumulate silently
          if (leaksThinking) continue;

          // For normal models: stream live
          if (firstContentToken) {
            stopSpin();
            if (inReasoningBlock) { process.stdout.write("\n\n"); inReasoningBlock = false; }
            firstContentToken = false;
          }
          process.stdout.write(delta.content);
        }

        if (parsed.usage) usage = parsed.usage;
      } catch {}
    }
  }

  // ── Post-processing ──
  let finalContent = rawContent;

  if (leaksThinking) {
    // Strip <think>...</think> blocks
    finalContent = rawContent.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // If there's no <think> tags but model is known to leak,
    // the entire raw content might be thinking + response
    // We can't reliably separate them without tags, so just show everything
    // But at least we didn't spam the terminal during streaming!

    stopSpin();
    if (finalContent) {
      process.stdout.write(finalContent);
      process.stdout.write("\n\n");
    }
  } else {
    // Normal model — streaming already displayed
    if (inReasoningBlock) process.stdout.write("\n");
    if (rawContent) process.stdout.write("\n\n");
    else if (firstContentToken) stopSpin();
  }

  return { content: finalContent, usage, reasoning: reasoningContent };
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
 * Estimate cost
 */
export function estimateCost(model, usage) {
  if (!usage) return { input: 0, output: 0, total: 0 };
  const prices = {
    "nvidia/nemotron-3-ultra-550b-a55b:free": { i: 0, o: 0 },
    "qwen/qwen3-coder:free": { i: 0, o: 0 },
    "openai/gpt-oss-120b:free": { i: 0, o: 0 },
    "nvidia/nemotron-3-super-120b-a12b:free": { i: 0, o: 0 },
    "meta-llama/llama-3.3-70b-instruct:free": { i: 0, o: 0 },
    "deepseek/deepseek-chat": { i: 0.14, o: 0.28 },
    "deepseek/deepseek-r1": { i: 0.55, o: 2.19 },
    "anthropic/claude-opus-4": { i: 15, o: 75 },
    "anthropic/claude-sonnet-4-20250514": { i: 3, o: 15 },
    "openai/gpt-4o": { i: 2.5, o: 10 },
    "google/gemini-2.0-flash-001": { i: 0.1, o: 0.4 },
    "google/gemini-2.5-pro-preview-03-25": { i: 1.25, o: 10 },
    "qwen/qwen-2.5-coder-32b-instruct": { i: 0.07, o: 0.16 },
  };
  const p = prices[model] || { i: 1, o: 3 };
  const input = (usage.prompt_tokens || 0) / 1e6 * p.i;
  const output = (usage.completion_tokens || 0) / 1e6 * p.o;
  return { input, output, total: input + output };
}
