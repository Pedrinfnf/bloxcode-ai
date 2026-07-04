// ═══════════════════════════════════════════════════════════════════════════════
// BLOXCODE v4.1 — Main Entry Point
// ═══════════════════════════════════════════════════════════════════════════════

import readline from "node:readline";
import path from "node:path";
import { _, S, formatDuration, notify } from "./core/ansi.js";
import { renderMarkdown } from "./core/markdown.js";
import { runHooks, checkSecurity, printSecurityWarnings } from "./core/hooks.js";
import { processFileRefs, isShellShortcut, getShellCommand, buildMessageWithAttachments } from "./core/input.js";
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
import { undo, showSessionDiff, snapshotSave, snapshotList, snapshotLoad } from "./tools/undo.js";
import { contextBar, shouldAutoCompact } from "./core/context.js";

const VERSION = "4.3.0";

// ═════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═════════════════════════════════════════════════════════════════════════════
async function buildSystemPrompt() {
  const files = await getFileCache();
  const conventions = await loadConventions();
  const skills = await loadSkills();
  const toolDesc = getToolDescriptions();

  let prompt = `Você é o BloxCode v${VERSION}, um agente AI de terminal para desenvolvimento de software.

## Identidade
- Workspace: ${WORKSPACE}
- Modo: ${MODES[state.currentMode].name} — ${MODES[state.currentMode].desc}
- Perfil: ${PROFILES[state.currentProfile].name} — ${PROFILES[state.currentProfile].desc}

## Como usar ferramentas
Responda com JSON para executar ferramentas:
\`\`\`json
{"type":"tool","tool":"nome_da_ferramenta","args":{"argumento":"valor"}}
\`\`\`

Quando terminar a tarefa, responda com:
\`\`\`json
{"type":"final","content":"sua resposta aqui"}
\`\`\`

IMPORTANTE:
- Você pode encadear MÚLTIPLAS chamadas de ferramenta em sequência
- SEMPRE leia (cat) um arquivo antes de editá-lo
- Use edit/apply_patch para mudar arquivos existentes, write para criar novos
- Após editar código, rode testes (shell/test) para verificar
- Se um tool call falhar, tente uma abordagem diferente

## Ferramentas disponíveis
${toolDesc}

## Workspace (${files.length} arquivos)
${files.slice(0, 50).join("\n")}${files.length > 50 ? `\n... (+${files.length - 50} mais)` : ""}

## Regras de conduta
1. Seja direto e conciso
2. Quando pedir para editar código, faça — não apenas sugira
3. Siga as convenções do projeto (ver abaixo)
4. Em caso de dúvida, leia o código existente antes
5. Não invente arquivos que não existem — use find/grep para verificar`;

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
    S("  🤖 BLOXCODE v4.3 — AI Terminal Agent", _.c, _.b),
    S(`  📂 ${WORKSPACE}`, _.G),
    S(`  🔑 API: ${keyStatus}`, _.d),
    S(`  🎮 Mode: ${MODES[state.currentMode].name} | 🛡️ ${PROFILES[state.currentProfile].name} | 🤖 ${router.alias(router.manualModel || "auto")}`, _.d),
    "",
    S("  /help             Ajuda completa", _.G),
    S("  /api set <key>    Configurar API key", _.G),
    S("  /model            Seletor interativo ↑↓", _.G),
    S("  @file.js <msg>    Anexa arquivo ao contexto", _.G),
    S("  !cmd              Roda shell (!!cmd = silent)", _.G),
    S("  /agent <task>     Multi-agente", _.G),
  ];
  console.log(drawBox(lines, { title: S("BLOXCODE v4.3", _.c), color: _.c, w: 76, double: true }));
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
    { title: "↩️ UNDO & DIFF", cmds: [
      ["/undo", "Desfaz última edição de arquivo"],
      ["/diff", "Mostra todas mudanças da sessão"],
      ["/retry", "Re-gera última resposta da IA"],
      ["/snapshot save [nome]", "Salva estado do workspace"],
      ["/snapshot list", "Lista snapshots"],
      ["/snapshot load <nome>", "Restaura snapshot"],
    ]},
    { title: "📎 ATALHOS", cmds: [
      ["@arquivo <msg>", "Anexa arquivo ao contexto (fuzzy match)"],
      ["@a.js @b.js compare", "Múltiplos arquivos"],
      ["!npm test", "Roda shell e adiciona output ao contexto"],
      ["!!npm test", "Roda shell silencioso (sem contexto)"],
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
            "/undo", "/diff", "/retry",
            "/snapshot save", "/snapshot list", "/snapshot load",
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
        const keyIcon = getApiKey() ? "" : S("⚠️ ", _.r);
        const ctxBar = contextBar(messages, router.lastUsedModel || router.manualModel || "");
        rl.setPrompt(`${keyIcon}${ctxBar} ${S("[", _.d)}${S(modeInfo.icon, modeInfo.color)}${S("|", _.d)}${modeStr}${S("|", _.d)}${modelShort}${rShort ? S("|", _.d) + rShort : ""}${S("]", _.d)} ${S(">", _.g)} `);
        origPrompt(preserveCursor);
      };

      const saved = await loadHistory();
      const sysPrompt = await buildSystemPrompt();
      let messages = [{ role: "system", content: sysPrompt }, ...(Array.isArray(saved) ? saved : [])];

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

        // ─── UNDO / DIFF / SNAPSHOT ───
        if (line === "/undo") { await undo(); continue; }
        if (line === "/diff") { showSessionDiff(); continue; }
        if (line.startsWith("/snapshot")) {
          const sub = line.slice(10).trim().split(/\s+/);
          if (sub[0] === "save") { await snapshotSave(sub[1]); }
          else if (sub[0] === "list" || sub[0] === "ls") {
            const snaps = await snapshotList();
            if (!snaps.length) { console.log(S("\nNenhum snapshot.\n", _.G)); }
            else { const rows = snaps.map(s => [s.name, `${s.edits || 0} edits | ${new Date(s.created || 0).toLocaleString()}`]); console.log(drawTable(rows, { title: "💾 SNAPSHOTS", color: _.c, w: 76 })); }
          } else if (sub[0] === "load" && sub[1]) { await snapshotLoad(sub[1]); }
          else { console.log(S("\nUso: /snapshot save [nome] | /snapshot list | /snapshot load <nome>\n", _.y)); }
          continue;
        }
        // ─── RETRY ───
        if (line === "/retry") {
          // Remove last assistant message and re-send
          const lastUserIdx = messages.findLastIndex(m => m.role === "user");
          if (lastUserIdx > 0) {
            // Remove everything after the last user message
            messages.splice(lastUserIdx + 1);
            console.log(S("\n🔄 Re-gerando última resposta…\n", _.c));
            // Fall through to chat — the user message is already in messages
            line = messages[lastUserIdx].content;
            // Don't push again, just continue to the chat section
          } else { console.log(S("\nNada para re-gerar.\n", _.G)); continue; }
        }

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

        // ─── ! SHELL SHORTCUT (like Claude Code & Pi) ───
        if (isShellShortcut(line)) {
          const { cmd, silent } = getShellCommand(line);
          if (!cmd) { console.log(S("Uso: !command ou !!command (silent)\n", _.y)); continue; }
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          try {
            const r = await promisify(execFile)("bash", ["-lc", cmd], { cwd: WORKSPACE, maxBuffer: 1024 * 1024, timeout: 60000 });
            const output = r.stdout || "(sem saída)";
            console.log(output);
            if (r.stderr) console.log(S(r.stderr, _.r));
            if (!silent) messages.push({ role: "user", content: `[Shell: ${cmd}]\n${output}` });
          } catch (err) { console.log(S(`Erro: ${err.message}`, _.r)); }
          console.log(""); continue;
        }

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

        // @ file references (like Claude Code & Pi)
        const { text: processedInput, attachments } = await processFileRefs(line);
        const finalInput = buildMessageWithAttachments(processedInput, attachments);
        messages.push({ role: "user", content: finalInput });

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

        // Smart auto-compact using context window tracking
        const currentModel = router.lastUsedModel || router.manualModel || "";
        if (shouldAutoCompact(messages, currentModel)) {
          console.log(S("\n🗜️ Contexto >75% — compactando automaticamente…", _.d));
          const compacted = await compactConversation(messages);
          messages.length = 0; messages.push(...compacted);
        }

        // ── Multi-step tool loop (like Claude Code / Codex) ──
        // The LLM can call tools repeatedly until it returns type:final
        // This is the key difference from v3.x — one prompt can do read→edit→test→commit
        let toolLoops = 0;
        const MAX_TOOL_LOOPS = 25;
        let chatDone = false;

        while (toolLoops < MAX_TOOL_LOOPS && !chatDone) {
          toolLoops++;
          let retries = 0;

          while (retries < 3) {
            retries++;
            try {
              startSpin("Pensando");
              const result = await streamChat(messages, modelToUse);
              stopSpin();
              const { content, usage, wasStreamed } = result;
              state.lastUsage = usage; state.lastCost = estimateCost(modelToUse, usage); trackUsage(usage, state.lastCost);

              if (!content) { console.log(S("Resposta vazia.\n", _.r)); chatDone = true; break; }

              // Try to parse as JSON (tool call or type:final)
              let parsed;
              try { parsed = extractJson(content); }
              catch {
                // Not JSON = plain text response
                if (!wasStreamed) console.log(content + "\n");
                messages.push({ role: "assistant", content });
                chatDone = true; break;
              }

              if (parsed.type === "final") {
                // Show the clean content, not the JSON wrapper
                const cleanContent = parsed.content || "";
                console.log(cleanContent + "\n");
                messages.push({ role: "assistant", content: cleanContent });
                chatDone = true; break;
              }

              if (parsed.type === "tool") {
                const tName = parsed.tool;
                // Run PreToolUse hooks (security checks, etc)
                await runHooks("PreToolUse", { tool: tName, args: parsed.args || {} });
                const toolResult = await runTool(tName, parsed.args || {});
                // Run PostToolUse hooks
                await runHooks("PostToolUse", { tool: tName, args: parsed.args || {}, result: toolResult });

                // Compact tool output display
                console.log(`\n${S("⚙️", _.d)} ${S(tName, _.c, _.b)} ${S("→", _.d)} ${S(toolResult.ok !== false ? "✅" : "❌", toolResult.ok !== false ? _.Gr : _.r)}`);
                const rStr = typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult, null, 2);
                const rLines = rStr.split("\n");
                if (rLines.length <= 8) { for (const l of rLines) console.log(S("  │ ", _.d) + l); }
                else { for (const l of rLines.slice(0, 5)) console.log(S("  │ ", _.d) + l); console.log(S(`  │ … (+${rLines.length - 5} lines)`, _.G)); }

                messages.push({ role: "user", content: `TOOL_RESULT:\n${JSON.stringify({ tool: tName, result: toolResult }, null, 2).slice(0, 4000)}` });
                break; // break retries, continue tool loop
              }

              // Unknown type
              chatDone = true; break;
            } catch (err) {
              stopSpin();
              const candidates = router.favorites[route.task] || router.favorites.default;
              const idx = candidates.indexOf(modelToUse);
              if (idx >= 0 && idx < candidates.length - 1) { modelToUse = candidates[idx + 1]; sessionStats.fallbacks++; continue; }
              console.error(S(`\n❌ Erro: ${err.message}\n`, _.r)); sessionStats.errors++; chatDone = true; break;
            }
          }
        }
        if (toolLoops >= MAX_TOOL_LOOPS) console.log(S(`\n⚠️ Limite de ${MAX_TOOL_LOOPS} tool calls atingido.\n`, _.y));
        await saveHistory(messages.slice(1));
      }

      rl.close(); cleanupMcp();
      console.log(S("\n👋 BloxCode v4.2 encerrado.\n", _.Gr, _.b));
      printStats();
    },
  };
}
