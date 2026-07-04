// ═══════════════════════════════════════════════════════════════════════════════
// LLM API — v4.3.1 — Buffer JSON responses, only stream plain text
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
 * Streaming chat — v4.3.1
 * 
 * KEY FIX: We always buffer the first ~200 chars before displaying anything.
 * If the response starts with { or ```, it's likely JSON (tool call or final).
 * In that case we buffer the ENTIRE response silently (no streaming display).
 * Only plain text gets streamed live to the terminal.
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
  let rawContent = "";
  let reasoningContent = "";
  let usage = null;
  
  // Buffering state: we collect initial tokens to detect JSON vs plain text
  let isBuffering = true;  // true until we decide if it's JSON or text
  let isJsonResponse = false;  // once decided: true = buffer all, false = stream
  let streamedSoFar = false;
  const BUFFER_THRESHOLD = 20; // chars before we decide

  const showReasoning = state.reasoningLevel !== "off";
  let inReasoningBlock = false;

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

        // ── Reasoning field ──
        const reasoningText = delta?.reasoning || delta?.reasoning_content || "";
        if (reasoningText) {
          reasoningContent += reasoningText;
          if (showReasoning && !leaksThinking) {
            if (!inReasoningBlock) { stopSpin(); process.stdout.write(S("\n💭 ", _.d)); inReasoningBlock = true; }
            process.stdout.write(S(reasoningText, _.d, _.i));
          }
          continue;
        }

        // ── Content ──
        if (delta?.content) {
          // Filter <think> tags
          if (delta.content.includes("<think>") || delta.content.includes("</think>")) {
            const cleaned = delta.content.replace(/<\/?think>/g, "");
            if (cleaned.trim()) reasoningContent += cleaned;
            continue;
          }

          rawContent += delta.content;
          sessionStats.streamingChunks++;

          // For thinking-leak models: always buffer silently
          if (leaksThinking) continue;

          // ── Buffering phase: collect initial chars to detect JSON ──
          if (isBuffering) {
            if (rawContent.length >= BUFFER_THRESHOLD) {
              isBuffering = false;
              const trimmed = rawContent.trimStart();
              // If starts with { or ``` or [ → it's JSON, buffer everything
              isJsonResponse = trimmed.startsWith("{") || trimmed.startsWith("```json") || trimmed.startsWith("[");
              
              if (!isJsonResponse) {
                // It's plain text — flush buffer and start streaming
                stopSpin();
                if (inReasoningBlock) { process.stdout.write("\n\n"); inReasoningBlock = false; }
                process.stdout.write(rawContent);
                streamedSoFar = true;
              }
              // If JSON: don't print anything, keep buffering
            }
            continue;
          }

          // ── Post-buffer: stream or buffer based on decision ──
          if (!isJsonResponse) {
            if (!streamedSoFar) {
              stopSpin();
              if (inReasoningBlock) { process.stdout.write("\n\n"); inReasoningBlock = false; }
              streamedSoFar = true;
            }
            process.stdout.write(delta.content);
          }
          // If JSON: keep accumulating silently
        }

        if (parsed.usage) usage = parsed.usage;
      } catch {}
    }
  }

  // ── Finalize ──
  let finalContent = rawContent;

  // Strip <think> blocks
  if (finalContent.includes("<think>")) {
    finalContent = finalContent.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  }

  stopSpin();

  if (leaksThinking || isJsonResponse || isBuffering) {
    // Wasn't streamed to screen — content is in finalContent
    // DON'T print here — let the caller (index.js) handle it
    // For JSON: caller will parse and show clean content
    // For thinking-leak: caller will parse and show clean content
    if (inReasoningBlock) process.stdout.write("\n");
  } else {
    // Was streamed live — just add newlines
    if (inReasoningBlock) process.stdout.write("\n");
    if (streamedSoFar) process.stdout.write("\n\n");
  }

  return { content: finalContent, usage, reasoning: reasoningContent, wasStreamed: streamedSoFar };
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
