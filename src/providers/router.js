// ═══════════════════════════════════════════════════════════════════════════════
// MODEL ROUTER — Smart model selection (inspired by OpenCode's multi-provider)
// Supports: auto-routing by task, manual selection, favorites, benchmarks
// ═══════════════════════════════════════════════════════════════════════════════

import { _, S } from "../core/ansi.js";
import { getApiKey, REFERER, TITLE, FETCH_TIMEOUT } from "../config/state.js";
import { drawTable, drawBox } from "../tui/box.js";
import { selectFromList } from "../tui/dialogs.js";

async function fetchWithTimeout(url, opts = {}, timeout = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally { clearTimeout(id); }
}

export class ModelRouter {
  constructor() {
    this.mode = "auto";
    this.manualModel = "";
    this.lastUsedModel = "";
    this.lastReason = "";
    this.modelsCache = null;
    this.cacheTime = 0;
    this.debug = false;
    this.quiet = false;

    this.favorites = {
      code: [
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "deepseek/deepseek-chat",
        "qwen/qwen-2.5-coder-32b-instruct",
        "mistralai/codestral-2501",
      ],
      reasoning: [
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "anthropic/claude-opus-4",
        "openai/gpt-4o",
        "deepseek/deepseek-r1",
      ],
      chat: [
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "google/gemini-2.0-flash-001",
        "meta-llama/llama-3.1-8b-instruct",
        "mistralai/mistral-7b-instruct",
      ],
      search: [
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "google/gemini-2.0-flash-001",
      ],
      image: [
        "stabilityai/stable-diffusion-xl-base-1.0",
        "openai/dall-e-3",
      ],
      default: ["nvidia/nemotron-3-ultra-550b-a55b:free"],
    };

    this.aliases = {
      "nvidia/nemotron-3-ultra-550b-a55b:free": "Nemotron 3 Ultra 🆓",
      "nvidia/nemotron-3-super-120b-a12b:free": "Nemotron 3 Super 🆓",
      "anthropic/claude-sonnet-4-20250514": "Claude Sonnet 4",
      "anthropic/claude-opus-4": "Claude Opus 4",
      "openai/gpt-4o": "GPT-4o",
      "google/gemini-2.5-pro-preview-03-25": "Gemini 2.5 Pro",
      "google/gemini-2.0-flash-001": "Gemini 2.0 Flash",
      "deepseek/deepseek-chat": "DeepSeek Chat",
      "deepseek/deepseek-r1": "DeepSeek R1",
      "qwen/qwen-2.5-coder-32b-instruct": "Qwen 2.5 Coder",
      "mistralai/codestral-2501": "Codestral",
      "meta-llama/llama-3.1-8b-instruct": "Llama 3.1 8B",
      "mistralai/mistral-7b-instruct": "Mistral 7B",
    };
  }

  alias(slug) {
    return this.aliases[slug] || slug.split("/").pop();
  }

  classifyTask(input) {
    const t = input.toLowerCase();
    if (/\b(imagem?|imagine|desenha|gera.*img|create.*image|generate.*image|draw|foto|picture|render|sprite|icon|texture|pixel)\b/i.test(t)) return "image";
    if (/\b(pesquisa|busca|search|google|noticia|atual|recente|202[5-9]|quem e|o que e|como fazer|wiki|noticias|news|latest|update|current|weather|price)\b/i.test(t)) return "search";
    if (/\b(codigo|script|funcao|function|class|debug|erro|bug|refatora|programa|lua|luau|python|js|javascript|html|css|react|roblox|api|endpoint|server|client|import|export|require)\b/i.test(t)) return "code";
    if (/\b(analisa|explica|por que|porque|compare|diferenca|logica|matematica|prova|complexo|profundo|raciocinio|reasoning|think|philosophy|science|physics|math)\b/i.test(t)) return "reasoning";
    return "chat";
  }

  selectModel(input, taskOverride = null) {
    const task = taskOverride || this.classifyTask(input);
    let selected = "", reason = "";
    if (this.mode === "manual" && this.manualModel) {
      selected = this.manualModel;
      reason = `manual (${task})`;
    } else {
      const candidates = this.favorites[task] || this.favorites.default;
      selected = candidates[0];
      reason = `auto-router: ${task} → ${this.alias(selected)}`;
    }
    this.lastUsedModel = selected;
    this.lastReason = reason;
    return { model: selected, task, reason };
  }

  async fetchModels() {
    if (this.modelsCache && Date.now() - this.cacheTime < 300000) return this.modelsCache;
    try {
      const res = await fetchWithTimeout("https://openrouter.ai/api/v1/models", {}, 30000);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      this.modelsCache = (data.data || []).sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
      this.cacheTime = Date.now();
      return this.modelsCache;
    } catch { return []; }
  }

  /**
   * Interactive model selector — OpenCode-style popup with arrow keys + search
   */
  async selectModelInteractive() {
    console.log(S("\n🔄 Carregando modelos do OpenRouter…\n", _.d));
    const models = await this.fetchModels();
    if (!models.length) {
      console.log(S("❌ Falha ao buscar modelos.\n", _.r));
      return null;
    }

    const items = models.slice(0, 100).map(m => ({
      id: m.id,
      label: this.alias(m.id),
      desc: `ctx:${(m.context_length / 1000).toFixed(0)}k · $${((m.pricing?.prompt || 0) * 1e6).toFixed(2)}/M`,
      tag: m.id.includes(":free") ? "FREE" : "",
    }));

    const result = await selectFromList(items, {
      title: "🤖 SELECT MODEL",
      hint: "↑↓ navigate · Type to filter · Enter select · Esc cancel",
      w: 72,
      maxVisible: 15,
    });

    if (result) {
      this.manualModel = result.id;
      this.mode = "manual";
      console.log(S(`\n✅ Modelo: ${result.label} (${result.id})\n`, _.Gr, _.b));
      return result;
    }

    console.log(S("\n↩️  Cancelado.\n", _.G));
    return null;
  }

  printFavorites() {
    const rows = Object.entries(this.favorites).map(([cat, models]) => [
      cat.toUpperCase(),
      models.map(m => this.alias(m)).join(", "),
    ]);
    console.log(drawTable(rows, { title: S("⭐ FAVORITOS", _.y), color: _.y, w: 76 }));
  }

  printCurrentModel() {
    const curr = this.mode === "manual" ? this.manualModel : (this.lastUsedModel || "auto");
    console.log(`\n${S("🤖 Modelo:", _.c)} ${S(this.alias(curr), _.y, _.b)}\n${S("   Slug:", _.G)} ${curr}\n${S("   Mode:", _.G)} ${this.mode.toUpperCase()}\n`);
  }

  async runBenchmark() {
    console.log(S("\n⏱️  Benchmark — testando modelos…\n", _.c));
    const test = [{ role: "user", content: "Reply with just 'OK'" }];
    const results = [];
    const candidates = this.favorites.default.concat(this.favorites.code.slice(0, 3));
    const unique = [...new Set(candidates)];

    for (const model of unique.slice(0, 5)) {
      const start = Date.now();
      try {
        const res = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${getApiKey()}`,
            "HTTP-Referer": REFERER,
            "X-Title": TITLE,
          },
          body: JSON.stringify({ model, messages: test, max_tokens: 10 }),
        }, 30000);
        const ms = Date.now() - start;
        results.push({ model: this.alias(model), ms, ok: res.ok });
      } catch {
        results.push({ model: this.alias(model), ms: -1, ok: false });
      }
    }

    results.sort((a, b) => a.ms - b.ms);
    const rows = results.map(r => [
      r.model,
      r.ok ? S(`${r.ms}ms`, r.ms < 2000 ? _.Gr : r.ms < 5000 ? _.y : _.r) : S("FAIL", _.r),
    ]);
    console.log(drawTable(rows, { title: "⏱️ BENCHMARK RESULTS", color: _.c, w: 76 }));
  }

  loadFromConfig(cfg) {
    if (cfg.routerMode) this.mode = cfg.routerMode;
    if (cfg.manualModel) this.manualModel = cfg.manualModel;
    if (cfg.debug) this.debug = cfg.debug;
    if (cfg.quiet) this.quiet = cfg.quiet;
  }

  toConfig() {
    return {
      routerMode: this.mode,
      manualModel: this.manualModel,
      debug: this.debug,
      quiet: this.quiet,
    };
  }
}

export const router = new ModelRouter();
