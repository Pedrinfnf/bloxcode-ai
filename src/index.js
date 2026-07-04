// ═══════════════════════════════════════════════════════════════════════════════
// BLOXCODE v4.1 — Main Entry Point
// ═══════════════════════════════════════════════════════════════════════════════

import readline from "node:readline";
import path from "node:path";
import { _, S, formatDuration, notify } from "./core/ansi.js";
import { drawBox, drawTable, startSpin, stopSpin, drawProgressBar } from "./tui/box.js";
import { selectFromList, confirm, textInput } from "./tui/dialogs.js";
import {
  WORKSPACE, MODES, PROFILES, VALID_REASONING,
  state, sessionStats, trackUsage, getApiKey, setApiKey, setApiBaseUrl,
  ensureDirs, loadConfig, saveConfig, loadHistory, saveHistory,
  loadAliases, saveAliases, getAliases, resolveAlias,
  loadConventions, loadSkills,
  listSessions, saveSession, loadSession,
} from "./config/state.js";
import { router } from "./providers/router.js";
import { chatAI, streamChat, extractJson, estimateCost } from "./providers/api.js";
import { getToolDescriptions, runTool, printToolsList } from "./tools/registry.js";
import { buildFileCache, getFileCache, toolTree, toolFind } from "./tools/files.js";
import { toolGitStatus, toolGitDiff, toolGitCommit, toolGitBranch, toolGitStash, toolTest } from "./tools/shell.js";
import { webSearch, generateImage } from "./tools/web.js";
import { createDefaultOrchestrator } from "./agents/agent.js";
import { loadMcpConfig, toolMcp, printMcpStatus, cleanupMcp } from "./mcp/client.js";

const VERSION = "4.1.0";

// ═════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═════════════════════════════════════════════════════════════════════════════
async function buildSystemPrompt() {
  const files = await getFileCache();
  const conventions = await loadConventions();
  const skills = await loadSkills();
  const toolDesc = getToolDescriptions();

  let prompt = `Você é o BloxCode v${VERSION}, um agente AI de terminal avançado.
Workspace: ${WORKSPACE}
Modo: ${MODES[state.currentMode].name}
Perfil: ${PROFILES[state.currentProfile].name}

## Tools
Para usar ferramentas, responda com JSON: {"type":"tool","tool":"nome","args":{...}}
Para resposta final: {"type":"final","content":"..."}

Ferramentas disponíveis:
${toolDesc}

## Workspace (${files.length} files)
${files.slice(0, 30).join("\n")}${files.length > 30 ? `\n... (+${files.length - 30} more)` : ""}`;

  if (conventions) prompt += `\n\n## Project Conventions\n${conventions}`;
  if (skills.length) prompt += `\n\n## Skills\n${skills.map(s => `### ${s.name}\n${s.content.slice(0, 2000)}`).join("\n")}`;
  return prompt;
}

// ═════════════════════════════════════════════════════════════════════════════
// COMPACT
// ═════════════════════════════════════════════════════════════════════════════
async function compactConversation(messages) {
  const sys = messages[0];
  const rest = messages.slice(1);
  if (rest.length < 6) return messages;
  try {
    startSpin("Compactando contexto");
    const summary = await chatAI([
      { role: "system", content: "Resuma esta conversa mantendo fatos, decisões e contexto essencial. Responda em texto puro." },
      ...rest.slice(0, -4),
    ], "nvidia/nemotron-3-ultra-550b-a55b:free");
    stopSpin();
    const content = summary.choices?.[0]?.message?.content || "";
    return [sys, { role: "user", content: `[Resumo automático]\n${content}` }, ...rest.slice(-4)];
  } catch { stopSpin(); return [sys, ...rest.slice(-8)]; }
}

// ═════════════════════════════════════════════════════════════════════════════
// BANNER & STATS
// ═════════════════════════════════════════════════════════════════════════════
function printBanner() {
  const keyStatus = getApiKey() ? S("✅ Configurada", _.Gr) : S("❌ NÃO CONFIGURADA — use /api set <key>", _.r, _.b);
  const lines = [
    S("  🤖 BLOXCODE v4.1 — AI Terminal Agent", _.c, _.b),
    S(`  📂 ${WORKSPACE}`, _.G),
    S(`  🔑 API: ${keyStatus}`, _.d),
    S(`  🎮 Mode: ${MODES[state.currentMode].name} | 🛡️ ${PROFILES[state.currentProfile].name} | 🤖 ${router.alias(router.manualModel || "auto")}`, _.d),
    "",
    S("  /help           Ajuda completa", _.G),
    S("  /api set <key>  Configurar API key do OpenRouter", _.G),
    S("  /model          Seletor interativo ↑↓ (como OpenCode)", _.G),
    S("  /agent <task>   Orquestrador multi-agente", _.G),
    S("  /session        Gerenciar sessões", _.G),
  ];
  console.log(drawBox(lines, { title: S("BLOXCODE v4.1", _.c), color: _.c, w: 76, double: true }));
}

function printStats() {
  const elapsed = Date.now() - sessionStats.startTime;
  const rows = [
    ["⏱️ Sessão", formatDuration(elapsed)],
    ["💬 Mensagens", String(sessionStats.messagesSent)],
    ["🔧 Tool Calls", `${sessionStats.toolCalls} (${Object.entries(sessionStats.toolCallsByType).map(([k, v]) => `${k}:${v}`).join(", ") || "nenhum"})`],
    ["📊 Tokens", `↗️${sessionStats.tokensUsed.prompt} ↘️${sessionStats.tokensUsed.completion} Σ${sessionStats.tokensUsed.total}`],
    ["💰 Custo", `$${sessionStats.totalCost.toFixed(6)}`],
    ["📁 Modificados", String(sessionStats.filesModified)],
    ["🐚 Shells", String(sessionStats.shellsRun)],
    ["🌐 Buscas", String(sessionStats.searchesRun)],
    ["❌ Erros", String(sessionStats.errors)],
  ];
  console.log(drawTable(rows, { title: "📊 SESSION STATS", color: _.c, w: 76 }));
}

function printHelp() {
  const sections = [
    { title: "🔑 API & CONFIG", cmds: [
      ["/api set <key>", "Define API key do OpenRouter"],
      ["/api show", "Mostra key atual (mascarada)"],
      ["/api url <url>", "Muda base URL (ex: Ollama local)"],
      ["/api status", "Status da API + key + url"],
    ]},
    { title: "⚡ CORE", cmds: [
      ["/help", "Esta ajuda"],
      ["/exit, /quit", "Sair"],
      ["/clear", "Limpa contexto"],
      ["/compact", "Compacta contexto"],
      ["/stats", "Dashboard da sessão"],
      ["/tokens, /cost", "Uso de tokens/custo"],
    ]},
    { title: "🤖 MODELOS (interativo!)", cmds: [
      ["/model", "Seletor ↑↓ interativo"],
      ["/model set <slug>", "Define modelo manual"],
      ["/model auto", "Ativa auto-router"],
      ["/model favorites", "Favoritos por categoria"],
      ["/model benchmark", "Testa velocidade"],
    ]},
    { title: "🎮 MODOS & PERFIS", cmds: [
      ["/mode <m>", "suggest|autoedit|fullauto|plan|scout"],
      ["/profile <p>", "safe|edit|full"],
      ["/reasoning", "Cicla: off→low→medium→high"],
    ]},
    { title: "🤖 SUB-AGENTES", cmds: [
      ["/agent <tarefa>", "Orquestrador multi-agente"],
      ["/agents", "Stats dos agentes"],
    ]},
    { title: "💾 SESSÕES", cmds: [
      ["/session save [nome]", "Salva sessão atual"],
      ["/session list", "Lista sessões salvas"],
      ["/session load", "Seletor interativo ↑↓"],
      ["/session new", "Nova sessão limpa"],
    ]},
    { title: "🔧 FERRAMENTAS", cmds: [
      ["/tools", "Lista todas as ferramentas"],
      ["/exec <cmd>", "Executa shell direto"],
      ["/test [fw]", "Roda testes"],
      ["/search <q>", "Busca web"],
      ["/image <prompt>", "Gera imagem"],
    ]},
    { title: "📁 GIT & PROJETO", cmds: [
      ["/git status|diff|commit|branch|stash|log", "Git"],
      ["/docker <action>", "Docker"],
      ["/pipeline cmd1;cmd2", "Pipeline"],
      ["/pkg install|remove", "Package manager"],
      ["/reindex", "Reindexa workspace"],
    ]},
    { title: "🔌 MCP & EXTRAS", cmds: [
      ["/mcp status", "Status dos MCP servers"],
      ["/alias add|list|remove", "Aliases (@nome)"],
      ["/export [md]", "Exporta conversa"],
      ["/debug on|off", "Debug mode"],
    ]},
  ];
  for (const sec of sections) {
    const lines = sec.cmds.map(([cmd, desc]) => `  ${S(cmd.padEnd(30), _.y)} ${S(desc, _.w)}`);
    console.log(drawBox(lines, { title: S(sec.title, _.c), color: _.c, w: 76 }));
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═════════════════════════════════════════════════════════════════════════════
export async function createApp() {
  await ensureDirs();
  const cfg = await loadConfig();
  router.loadFromConfig(cfg);
  await loadAliases();
  await loadMcpConfig();
  await getFileCache();

  const orchestrator = createDefaultOrchestrator();

  return {
    run: async () => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer: (line) => {
          const COMMANDS = [
            "/help", "/exit", "/quit", "/clear", "/compact", "/stats", "/tokens", "/cost",
            "/api set", "/api show", "/api url", "/api status",
            "/model", "/model current", "/model list", "/model set", "/model auto",
            "/model favorites", "/model benchmark",
            "/mode suggest", "/mode autoedit", "/mode fullauto", "/mode plan", "/mode scout",
            "/profile safe", "/profile edit", "/profile full",
            "/reasoning", "/tools",
            "/agent", "/agents",
            "/session save", "/session list", "/session load", "/session new",
            "/exec", "/test", "/search", "/image",
            "/git status", "/git diff", "/git commit", "/git branch", "/git stash", "/git log",
            "/docker", "/pipeline", "/pkg",
            "/mcp status",
            "/alias add", "/alias list", "/alias remove",
            "/export", "/reindex", "/debug on", "/debug off", "/quiet",
          ];
          const hits = COMMANDS.filter(c => c.startsWith(line));
          return [hits.length ? hits : COMMANDS, line];
        },
      });

      process.on("SIGINT", () => { console.log(S("\n\n⚡ Ctrl+C — Use /exit para sair.\n", _.y)); rl.prompt(); });

      // Custom prompt
      const origPrompt = rl.prompt.bind(rl);
      rl.prompt = function(preserveCursor) {
        const modeInfo = MODES[state.currentMode];
        const modeStr = router.mode === "auto" ? S("A", _.Gr) : S("M", _.y);
        const modelShort = router.alias(router.mode === "manual" ? router.manualModel : (router.lastUsedModel || "auto")).slice(0, 12);
        const rShort = state.reasoningLevel !== "off" ? S(state.reasoningLevel[0].toUpperCase(), _.y) : "";
        const keyIcon = getApiKey() ? S("🔑", _.Gr) : S("⚠️", _.r);
        rl.setPrompt(`${keyIcon}${S("[", _.d)}${S(modeInfo.icon, modeInfo.color)}${S("|", _.d)}${modeStr}${S("|", _.d)}${modelShort}${rShort ? S("|", _.d) + rShort : ""}${S("]", _.d)} ${S(">", _.g)} `);
        origPrompt(preserveCursor);
      };

      const saved = await loadHistory();
      const sysPrompt = await buildSystemPrompt();
      let messages = [{ role: "system", content: sysPrompt }, ...saved];

      printBanner();

      // ═══════════════════════════════════════════════════════════════════════
      // MAIN LOOP
      // ═══════════════════════════════════════════════════════════════════════
      while (true) {
        rl.prompt();
        let input = await new Promise(resolve => rl.once("line", resolve));
        let line = input.trim();
        if (!line) continue;
        line = resolveAlias(line);

        if (line === "/exit" || line === "/quit") break;

        // ─── API COMMANDS (NEW!) ───
        if (line === "/api set" || line === "/api") {
          const key = await textInput(S("🔑 Cole sua API key do OpenRouter: ", _.y));
          if (key.trim()) {
            await setApiKey(key);
            console.log(S(`\n✅ API key salva! (${key.slice(0, 8)}...${key.slice(-4)})\n`, _.Gr, _.b));
            console.log(S("   Salva em ~/.bloxcode/config.json (persistente)\n", _.d));
          } else { console.log(S("\n❌ Cancelado.\n", _.r)); }
          continue;
        }
        if (line.startsWith("/api set ")) {
          const key = line.slice(9).trim();
          if (key) {
            await setApiKey(key);
            console.log(S(`\n✅ API key salva! (${key.slice(0, 8)}...${key.slice(-4)})\n`, _.Gr, _.b));
          } else { console.log(S("\n❌ Key vazia.\n", _.r)); }
          continue;
        }
        if (line === "/api show") {
          const key = getApiKey();
          if (key) console.log(`\n${S("🔑 API Key:", _.c)} ${S(key.slice(0, 10) + "..." + key.slice(-4), _.y)}\n${S("   Base URL:", _.G)} ${state.apiBaseUrl}\n`);
          else console.log(S("\n❌ Nenhuma API key configurada. Use /api set <key>\n", _.r));
          continue;
        }
        if (line === "/api status") {
          const key = getApiKey();
          const rows = [
            ["🔑 API Key", key ? S(`${key.slice(0, 10)}...${key.slice(-4)}`, _.Gr) : S("NÃO CONFIGURADA", _.r, _.b)],
            ["🌐 Base URL", S(state.apiBaseUrl, _.c)],
            ["📍 Fonte", key ? (process.env.OPENROUTER_API_KEY ? "ENV var" : "~/.bloxcode/config.json") : "—"],
          ];
          console.log(drawTable(rows, { title: "🔑 API STATUS", color: _.c, w: 76 }));
          continue;
        }
        if (line.startsWith("/api url ")) {
          const url = line.slice(9).trim();
          if (url) {
            await setApiBaseUrl(url);
            console.log(S(`\n✅ Base URL: ${url}\n`, _.Gr));
          }
          continue;
        }

        // ─── CORE ───
        if (line === "/help") { printHelp(); continue; }
        if (line === "/clear") { messages = [{ role: "system", content: await buildSystemPrompt() }]; await saveHistory([]); console.log(S("\n🗑️ Contexto limpo.\n", _.Gr)); continue; }
        if (line === "/compact") { const c = await compactConversation(messages); messages.length = 0; messages.push(...c); await saveHistory(messages.slice(1)); console.log(S("\n🗜️ Compactado.\n", _.Gr)); continue; }
        if (line === "/stats") { printStats(); continue; }
        if (line === "/tools") { printToolsList(); continue; }
        if (line === "/reindex") { console.log(S("🔄 Reindexando…", _.d)); await buildFileCache(); const fc = await getFileCache(); console.log(S(`✅ ${fc.length} arquivos.\n`, _.Gr)); continue; }
        if (line === "/tokens") { if (state.lastUsage) console.log(`\n${S("📝 Tokens:", _.c)}  prompt=${S(String(state.lastUsage.prompt_tokens), _.y)}  completion=${S(String(state.lastUsage.completion_tokens), _.Gr)}  total=${S(String(state.lastUsage.total_tokens), _.b)}\n`); else console.log(S("\nNenhuma resposta ainda.\n", _.G)); continue; }
        if (line === "/cost") { if (state.lastCost) console.log(`\n${S("💰 Custo:", _.c)}  $${S(state.lastCost.total.toFixed(6), _.y, _.b)}\n`); else console.log(S("\nNenhuma resposta ainda.\n", _.G)); continue; }
        if (line === "/quiet") { router.quiet = !router.quiet; await saveConfig(router.toConfig()); console.log(S(`\n${router.quiet ? "🔇" : "🔊"} Quiet: ${router.quiet ? "ON" : "OFF"}\n`, router.quiet ? _.d : _.w)); continue; }

        // ─── MODEL ───
        if (line === "/model" || line === "/model list") { await router.selectModelInteractive(); await saveConfig(router.toConfig()); continue; }
        if (line === "/model current") { router.printCurrentModel(); continue; }
        if (line === "/model favorites") { router.printFavorites(); continue; }
        if (line === "/model auto") { router.mode = "auto"; router.manualModel = ""; await saveConfig(router.toConfig()); console.log(S("\n✅ AUTO-ROUTER ativado.\n", _.Gr)); continue; }
        if (line === "/model benchmark") { await router.runBenchmark(); continue; }
        if (line.startsWith("/model set ")) { const slug = line.slice(11).trim(); if (slug) { router.manualModel = slug; router.mode = "manual"; await saveConfig(router.toConfig()); console.log(S(`\n✅ Manual: ${router.alias(slug)}\n`, _.Gr)); } continue; }

        // ─── MODE ───
        if (line.startsWith("/mode ")) {
          const modeName = line.slice(6).trim();
          if (MODES[modeName]) { state.currentMode = modeName; await saveConfig(); console.log(S(`\n${MODES[modeName].icon} Modo: ${MODES[modeName].name}\n   ${MODES[modeName].desc}\n`, MODES[modeName].color, _.b)); }
          else console.log(S(`\n❌ Modos: ${Object.keys(MODES).join(", ")}\n`, _.r));
          continue;
        }
        if (line.startsWith("/profile ")) {
          const profName = line.slice(9).trim();
          if (PROFILES[profName]) { state.currentProfile = profName; await saveConfig(); console.log(S(`\n${PROFILES[profName].icon} Perfil: ${PROFILES[profName].name}\n   ${PROFILES[profName].desc}\n`, _.y, _.b)); }
          else console.log(S(`\n❌ Perfis: ${Object.keys(PROFILES).join(", ")}\n`, _.r));
          continue;
        }
        if (line === "/reasoning") {
          const idx = VALID_REASONING.indexOf(state.reasoningLevel);
          state.reasoningLevel = VALID_REASONING[(idx + 1) % VALID_REASONING.length];
          const colors = { high: _.r, medium: _.y, low: _.Gr, off: _.G };
          console.log(S(`\n🧠 Reasoning: ${state.reasoningLevel.toUpperCase()}\n`, colors[state.reasoningLevel], _.b));
          await saveConfig(); continue;
        }

        // ─── SESSIONS (NEW!) ───
        if (line.startsWith("/session")) {
          const sub = line.slice(9).trim();
          if (sub === "list" || sub === "ls") {
            const sessions = await listSessions();
            if (!sessions.length) { console.log(S("\nNenhuma sessão salva.\n", _.G)); continue; }
            const items = sessions.map(s => ({ id: s.id, label: s.title || s.id, desc: `${s.messages} msgs` }));
            console.log(drawTable(items.map(i => [i.label, i.desc]), { title: "💾 SESSIONS", color: _.c, w: 76 }));
          } else if (sub === "load") {
            const sessions = await listSessions();
            if (!sessions.length) { console.log(S("\nNenhuma sessão.\n", _.G)); continue; }
            const items = sessions.map(s => ({ id: s.id, label: s.title || s.id, desc: `${s.messages} msgs` }));
            const selected = await selectFromList(items, { title: "💾 LOAD SESSION", w: 64 });
            if (selected) {
              const data = await loadSession(selected.id);
              if (data) {
                messages = [{ role: "system", content: await buildSystemPrompt() }, ...(data.messages || [])];
                console.log(S(`\n✅ Sessão '${selected.label}' carregada (${data.messages?.length || 0} msgs)\n`, _.Gr));
              }
            }
          } else if (sub.startsWith("save")) {
            const name = sub.slice(5).trim() || `session-${Date.now()}`;
            const id = name.replace(/[^a-zA-Z0-9_-]/g, "_");
            await saveSession(id, name, messages.slice(1));
            console.log(S(`\n✅ Sessão '${name}' salva.\n`, _.Gr));
          } else if (sub === "new") {
            messages = [{ role: "system", content: await buildSystemPrompt() }];
            await saveHistory([]);
            console.log(S("\n🆕 Nova sessão iniciada.\n", _.Gr));
          } else {
            console.log(S("\nUso: /session save|list|load|new\n", _.y));
          }
          continue;
        }

        // ─── AGENT ───
        if (line.startsWith("/agent ")) {
          const task = line.slice(7).trim();
          if (!task) { console.log(S("Uso: /agent <tarefa>\n", _.y)); continue; }
          if (!getApiKey()) { console.log(S("\n❌ Configure a API key primeiro: /api set <key>\n", _.r)); continue; }
          const result = await orchestrator.execute(task);
          for (const r of result.results) {
            if (r.type === "tool" && r.result) messages.push({ role: "user", content: `[${r.agent}] Tool ${r.tool}: ${JSON.stringify(r.result).slice(0, 2000)}` });
            else if (r.content) messages.push({ role: "assistant", content: `[${r.agent}] ${r.content}` });
          }
          continue;
        }
        if (line === "/agents") { orchestrator.printStats(); continue; }

        // ─── GIT ───
        if (line === "/git status") { const r = await toolGitStatus(); console.log(r.ok ? r.status : S(r.error, _.r)); console.log(""); continue; }
        if (line === "/git diff") { const r = await toolGitDiff(); console.log(r.ok ? r.diff : S(r.error, _.r)); console.log(""); continue; }
        if (line.startsWith("/git commit ")) { const msg = line.slice(12).trim(); const r = await toolGitCommit({ message: msg }); console.log(r.ok ? S(r.output, _.Gr) : S(r.error, _.r)); console.log(""); continue; }
        if (line.startsWith("/git branch ")) { const name = line.slice(12).trim(); const r = await toolGitBranch({ name }); console.log(r.ok ? S(r.output, _.Gr) : S(r.error, _.r)); console.log(""); continue; }
        if (line === "/git stash") { const r = await toolGitStash(); console.log(r.ok ? S(r.output, _.Gr) : S(r.error, _.r)); console.log(""); continue; }

        // ─── EXEC / TEST / SEARCH / IMAGE ───
        if (line.startsWith("/exec ")) {
          const cmd = line.slice(6).trim();
          if (!cmd) { console.log(S("Uso: /exec <cmd>\n", _.y)); continue; }
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          try { const r = await promisify(execFile)("bash", ["-lc", cmd], { cwd: WORKSPACE, maxBuffer: 1024 * 1024, timeout: 60000 }); console.log(r.stdout || S("(sem saída)", _.G)); if (r.stderr) console.log(S(r.stderr, _.r)); }
          catch (err) { console.log(S(`Erro: ${err.message}`, _.r)); }
          console.log(""); continue;
        }
        if (line === "/test" || line.startsWith("/test ")) { const fw = line.slice(5).trim() || undefined; const r = await toolTest({ framework: fw }); console.log(r.ok ? r.stdout : S(r.error, _.r)); if (r.stderr) console.log(S(r.stderr, _.r)); console.log(""); continue; }
        if (line.startsWith("/search ")) {
          const q = line.slice(8).trim();
          if (!q) { console.log(S("Uso: /search <query>\n", _.y)); continue; }
          startSpin("Buscando"); const results = await webSearch(q); stopSpin();
          const resLines = results.map((r, i) => `${S(String(i + 1), _.y)} ${S(r.title, _.b, _.w)}\n   ${S(r.snippet, _.G)}`);
          console.log(drawBox(resLines, { title: S("🌐 RESULTADOS", _.c), color: _.c, w: 76 }));
          messages.push({ role: "user", content: `[Busca "${q}"]\n${results.map(r => `- ${r.title}: ${r.snippet}`).join("\n")}` });
          continue;
        }
        if (line.startsWith("/image ")) {
          const prompt = line.slice(7).trim();
          if (!prompt) { console.log(S("Uso: /image <prompt>\n", _.y)); continue; }
          startSpin("Gerando imagem"); const res = await generateImage(prompt); stopSpin();
          if (res.ok) console.log(S(`\n✅ Imagem: ${res.file} (${(res.bytes / 1024).toFixed(1)} KB)\n`, _.Gr));
          else console.log(S(`\n❌ ${res.error}\n`, _.r));
          continue;
        }

        // ─── MCP / ALIAS / EXPORT / DEBUG ───
        if (line === "/mcp status") { printMcpStatus(); continue; }
        if (line.startsWith("/mcp ")) { const parts = line.slice(5).trim().split(/\s+/); const r = await toolMcp({ server: parts[0], tool: parts[1], args: parts.slice(2).join(" ") ? { input: parts.slice(2).join(" ") } : {} }); console.log(JSON.stringify(r, null, 2)); continue; }
        if (line.startsWith("/alias")) {
          const parts = line.slice(6).trim().split(/\s+/);
          if (parts[0] === "add" && parts.length >= 3) { const aliases = getAliases(); aliases[parts[1]] = parts.slice(2).join(" "); await saveAliases(aliases); console.log(S(`\n✅ @${parts[1]} → '${parts.slice(2).join(" ")}'\n`, _.Gr)); }
          else if (parts[0] === "list" || parts[0] === "ls") { const aliases = getAliases(); if (!Object.keys(aliases).length) console.log(S("\nNenhum alias.\n", _.G)); else { const lines = Object.entries(aliases).map(([k, v]) => `  ${S("@" + k, _.y)} → ${S(v, _.w)}`); console.log(drawBox(lines, { title: S("🔗 ALIASES", _.c), color: _.c, w: 76 })); } }
          else if (parts[0] === "remove" && parts[1]) { const aliases = getAliases(); delete aliases[parts[1]]; await saveAliases(aliases); console.log(S(`\n✅ Removido.\n`, _.Gr)); }
          else console.log(S("\nUso: /alias add <nome> <cmd> | /alias list | /alias remove <nome>\n", _.y));
          continue;
        }
        if (line.startsWith("/export")) { const fs2 = await import("node:fs/promises"); const fmt = line.includes("md") ? "md" : "json"; const fn = `bloxcode_export_${Date.now()}.${fmt}`; const fp = path.join(WORKSPACE, fn); if (fmt === "md") await fs2.writeFile(fp, messages.slice(1).map(m => `### ${m.role}\n${m.content}\n`).join("\n---\n\n"), "utf8"); else await fs2.writeFile(fp, JSON.stringify(messages.slice(1), null, 2), "utf8"); console.log(S(`\n✅ Exportado: ${fn}\n`, _.Gr, _.b)); continue; }
        if (line === "/debug on") { router.debug = true; await saveConfig(router.toConfig()); console.log(S("\n🐛 DEBUG ON\n", _.r)); continue; }
        if (line === "/debug off") { router.debug = false; await saveConfig(router.toConfig()); console.log(S("\n🐛 DEBUG OFF\n", _.G)); continue; }

        // ─── UNKNOWN COMMAND ───
        if (line.startsWith("/")) { console.log(S("Comando desconhecido. Use /help\n", _.r)); continue; }

        // ═════════════════════════════════════════════════════════════════════
        // CHAT — requires API key
        // ═════════════════════════════════════════════════════════════════════
        if (!getApiKey()) {
          console.log(S("\n❌ API key não configurada!", _.r, _.b));
          console.log(S("   Use: /api set <sua-key-do-openrouter>", _.y));
          console.log(S("   Crie em: https://openrouter.ai/keys\n", _.d));
          continue;
        }

        sessionStats.messagesSent++;
        messages.push({ role: "user", content: line });

        // Scout mode
        if (state.currentMode === "scout") {
          console.log(S("\n🔍 Scout: pesquisando workspace…", _.d));
          const tree = await toolTree({ path: ".", depth: 2 });
          const files = await toolFind({ path: ".", pattern: "\\.(lua|luau|js|ts|py|json|md)$" });
          messages.push({ role: "user", content: `[Workspace]\n${tree.tree}\n\nArquivos:\n${files.matches.slice(0, 20).join("\n")}` });
        }

        // Plan mode
        if (state.currentMode === "plan") {
          console.log(S("\n📋 Gerando plano…", _.m));
          try {
            startSpin("Planejando");
            const planData = await chatAI([
              { role: "system", content: 'Gere um plano em JSON: {"type":"plan","steps":[{"action":"tool","args":{},"reason":"..."}]}' },
              { role: "user", content: `Tarefa: ${line}` },
            ], "nvidia/nemotron-3-ultra-550b-a55b:free");
            stopSpin();
            try {
              const plan = extractJson(planData.choices?.[0]?.message?.content || "");
              if (plan.type === "plan" && plan.steps) {
                const planLines = plan.steps.map((s, i) => `${S(String(i + 1), _.y)} ${S(s.action, _.c, _.b)}: ${s.reason}`);
                console.log(drawBox(planLines, { title: S("📋 PLANO", _.m), color: _.m, w: 76 }));
                const ok = await confirm(S("Executar?", _.y));
                if (!ok) { console.log(S("\n❌ Cancelado.\n", _.r)); continue; }
                for (const step of plan.steps) { if (step.action) { const result = await runTool(step.action, step.args || {}); messages.push({ role: "user", content: `TOOL_RESULT (${step.action}):\n${JSON.stringify(result, null, 2)}` }); } }
              }
            } catch {}
          } catch { stopSpin(); }
        }

        const route = router.selectModel(line);
        let modelToUse = route.model;
        if (router.debug) console.log(S(`\n[DEBUG] Task: ${route.task} | Model: ${router.alias(modelToUse)}`, _.d));

        // Auto compact
        const totalChars = messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
        if (totalChars > 120000) { const compacted = await compactConversation(messages); messages.length = 0; messages.push(...compacted); }

        // Chat loop
        let attempts = 0, success = false;
        while (attempts < 8 && !success) {
          attempts++;
          try {
            startSpin("Pensando");
            const result = await streamChat(messages, modelToUse);
            stopSpin();
            const { content, usage } = result;
            state.lastUsage = usage; state.lastCost = estimateCost(modelToUse, usage); trackUsage(usage, state.lastCost);
            if (!content) { console.log(S("Resposta vazia.\n", _.r)); break; }
            let parsed;
            try { parsed = extractJson(content); } catch { messages.push({ role: "assistant", content }); success = true; break; }
            messages.push({ role: "assistant", content: JSON.stringify(parsed) });
            if (parsed.type === "final") { success = true; break; }
            if (parsed.type === "tool") {
              const tName = parsed.tool;
              const toolResult = await runTool(tName, parsed.args || {});
              console.log(`\n${S("┌─", _.d)} ${S(tName.toUpperCase(), _.y, _.b)} ${S("─".repeat(50), _.d)}`);
              const rStr = typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult, null, 2);
              for (const l of rStr.split("\n").slice(0, 25)) console.log(S("│ ", _.d) + l);
              if (rStr.split("\n").length > 25) console.log(S("│ … (truncado)", _.G));
              console.log(S("└" + "─".repeat(60), _.d));
              messages.push({ role: "user", content: `TOOL_RESULT:\n${JSON.stringify({ tool: tName, result: toolResult }, null, 2)}` });
              continue;
            }
            success = true;
          } catch (err) {
            stopSpin();
            const candidates = router.favorites[route.task] || router.favorites.default;
            const idx = candidates.indexOf(modelToUse);
            if (idx >= 0 && idx < candidates.length - 1) { modelToUse = candidates[idx + 1]; sessionStats.fallbacks++; continue; }
            console.error(S(`\n❌ Erro: ${err.message}\n`, _.r)); sessionStats.errors++; break;
          }
        }
        await saveHistory(messages.slice(1));
      }

      rl.close(); cleanupMcp();
      console.log(S("\n👋 BloxCode v4.1 encerrado.\n", _.Gr, _.b));
      printStats();
    },
  };
}
