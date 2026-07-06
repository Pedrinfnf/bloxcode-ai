// ═══════════════════════════════════════════════════════════════════════════════
// LLM CLIENT — Smart streaming with JSON detection
// ═══════════════════════════════════════════════════════════════════════════════

import type { ChatMessage, StreamResult, TokenUsage } from "@bloxcode/common";

export class LLMClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://openrouter.ai/api/v1") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  setApiKey(key: string) { this.apiKey = key; }
  setBaseUrl(url: string) { this.baseUrl = url.replace(/\/+$/, ""); }

  async chat(messages: ChatMessage[], model: string): Promise<{ content: string; usage: TokenUsage | null }> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model, messages, max_tokens: 4096, temperature: 0.3, stream: false }),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as any;
    return {
      content: data.choices?.[0]?.message?.content || "",
      usage: data.usage || null,
    };
  }

  async stream(
    messages: ChatMessage[],
    model: string,
    onTextChunk?: (chunk: string) => void,
  ): Promise<StreamResult> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model, messages, max_tokens: 4096, temperature: 0.3, stream: true }),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);

    let content = "";
    let reasoning = "";
    let usage: TokenUsage | null = null;
    let phase: "detecting" | "streaming" | "buffering" = "detecting";
    let pending = "";
    let wasStreamed = false;

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });

      while (sseBuffer.includes("\n")) {
        const idx = sseBuffer.indexOf("\n");
        const line = sseBuffer.slice(0, idx).trim();
        sseBuffer = sseBuffer.slice(idx + 1);

        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;

          const rText = delta?.reasoning || delta?.reasoning_content || "";
          if (rText) { reasoning += rText; continue; }

          if (delta?.content) {
            let chunk: string = delta.content;
            if (chunk.includes("<think>") || chunk.includes("</think>")) {
              reasoning += chunk.replace(/<\/?think>/g, "");
              continue;
            }

            content += chunk;

            if (phase === "detecting") {
              pending += chunk;
              if (pending.length >= 30) {
                const t = pending.trimStart();
                if (t.startsWith("{") || t.startsWith("[") || t.startsWith("```json")) {
                  phase = "buffering";
                } else {
                  phase = "streaming";
                  wasStreamed = true;
                  onTextChunk?.(pending);
                }
                pending = "";
              }
            } else if (phase === "streaming") {
              if (chunk.trimStart().startsWith('{"type"')) { phase = "buffering"; continue; }
              onTextChunk?.(chunk);
            }
          }

          if (parsed.usage) usage = parsed.usage;
        } catch {}
      }
    }

    // Short response still detecting
    if (phase === "detecting" && pending) {
      const t = pending.trimStart();
      if (t.startsWith("{") || t.startsWith("[")) { phase = "buffering"; }
      else { onTextChunk?.(pending); wasStreamed = true; phase = "streaming"; }
    }

    // Strip <think> blocks
    let finalContent = content;
    if (finalContent.includes("<think>")) {
      finalContent = finalContent.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    }

    return { content: finalContent, reasoning, isJson: phase === "buffering", wasStreamed, usage };
  }

  private headers() {
    if (!this.apiKey) throw new Error("API key not set. Use /api set <key>");
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
      "HTTP-Referer": "http://localhost",
      "X-Title": "BloxCode",
    };
  }
}
