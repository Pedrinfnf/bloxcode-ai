// ═══════════════════════════════════════════════════════════════════════════════
// WEB TOOLS — Search, Fetch, Image Generation
// ═══════════════════════════════════════════════════════════════════════════════

import fs from "node:fs/promises";
import path from "node:path";
import { _, S, clip } from "../core/ansi.js";
import { WORKSPACE, sessionStats } from "../config/state.js";

async function fetchWithTimeout(url, opts = {}, timeout = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

// ── Web Search (DuckDuckGo) ──
export async function webSearch(query) {
  const q = encodeURIComponent(query);
  for (const url of [`https://lite.duckduckgo.com/lite/?q=${q}`, `https://html.duckduckgo.com/html/?q=${q}`]) {
    try {
      const res = await fetchWithTimeout(url, {
        headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36", "Accept": "text/html" },
      }, 15000);
      const html = await res.text();
      const results = [];
      const linkRe = /<a[^>]+class="result-link"[^>]*>(.*?)<\/a>/gi;
      const snippetRe = /<td[^>]+class="result-snippet"[^>]*>(.*?)<\/td>/gi;
      let links = [], snippets = [], m;
      while ((m = linkRe.exec(html)) !== null) { const c = m[1].replace(/<[^>]+>/g, "").trim(); if (c) links.push(c); }
      while ((m = snippetRe.exec(html)) !== null) { const c = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); if (c) snippets.push(c); }
      for (let i = 0; i < Math.min(links.length, snippets.length, 5); i++) results.push({ title: links[i], snippet: snippets[i] });
      if (results.length > 0) { sessionStats.searchesRun++; return results; }
    } catch { continue; }
  }
  return [{ title: "Sem resultados", snippet: "Não foi possível buscar na web." }];
}

// ── URL Fetch (like OpenCode fetch tool) ──
export async function toolFetch({ url, maxChars = 8000 } = {}) {
  if (!url) throw new Error("fetch precisa de url");
  try {
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": "Mozilla/5.0 BloxCode/4.0" },
    }, 30000);
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text") || contentType.includes("json") || contentType.includes("xml")) {
      const text = await res.text();
      // Strip HTML tags for cleaner output
      const clean = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { ok: true, url, contentType, content: clip(clean, maxChars) };
    }
    return { ok: true, url, contentType, content: `[Binary: ${contentType}, ${res.headers.get("content-length") || "?"} bytes]` };
  } catch (err) { return { ok: false, error: err.message }; }
}

// ── Image Generation (Pollinations) ──
export async function generateImage(prompt) {
  const safePrompt = encodeURIComponent(prompt);
  const filename = `bloxcode_img_${Date.now()}.png`;
  const filepath = path.join(WORKSPACE, filename);
  try {
    const url = `https://image.pollinations.ai/prompt/${safePrompt}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 999999)}`;
    const res = await fetchWithTimeout(url, {}, 60000);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(filepath, buf);
      sessionStats.imagesGenerated++;
      return { ok: true, engine: "pollinations", file: filename, path: filepath, bytes: buf.length };
    }
  } catch {}
  return { ok: false, error: "Falha ao gerar imagem." };
}

// ── Sourcegraph search ──
export async function toolSourcegraph({ query, repo } = {}) {
  if (!query) throw new Error("sourcegraph precisa de query");
  const q = encodeURIComponent(`${repo ? `repo:${repo} ` : ""}${query}`);
  try {
    const res = await fetchWithTimeout(`https://sourcegraph.com/search?q=${q}&patternType=literal`, {
      headers: { "User-Agent": "Mozilla/5.0 BloxCode/4.0", "Accept": "text/html" },
    }, 15000);
    const html = await res.text();
    return { ok: true, content: clip(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "), 4000) };
  } catch (err) { return { ok: false, error: err.message }; }
}
