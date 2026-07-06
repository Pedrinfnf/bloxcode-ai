#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════════════════════════
// BLOXCODE CLI v0.1.0 — TypeScript Entry Point
// ═══════════════════════════════════════════════════════════════════════════════

import readline from "node:readline";
import { LLMClient, createDefaultAgents, MCPClient, registerBuiltinTools, type Orchestrator } from "@bloxcode/agent";
import { getToolDescriptions, runTool, getAllTools } from "@bloxcode/common";
import type { ChatMessage } from "@bloxcode/common";
import { loadConfig, saveConfig, type AppConfig } from "./config.js";
import { systemPrompt } from "./prompt.js";

const VERSION = "0.1.0";
const C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", italic: "\x1b[3m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m",
  magenta: "\x1b[35m", cyan: "\x1b[36m", white: "\x1b[37m", gray: "\x1b[90m",
  brightGreen: "\x1b[92m", brightYellow: "\x1b[93m", brightCyan: "\x1b[96m" };

const c = (text: string, ...styles: string[]) => styles.join("") + text + C.reset;

async function main() {
  const config = await loadConfig();
  const llm = new LLMClient(config.apiKey, config.apiBaseUrl);
  const mcp = new MCPClient();
  registerBuiltinTools();
  const agents = createDefaultAgents(llm, config.model);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(config, VERSION) },
  ];

  // ── Banner ──
  console.log("");
  console.log(c("  ● bloxcode", C.cyan, C.bold));
  console.log(c(`  v${VERSION}`, C.gray) + c(" · ", C.gray) + c(config.model.split("/").pop() || "auto", C.cyan) + c(" · ", C.gray) + c(config.mode, C.yellow));
  if (!config.apiKey) console.log(c("  ⚠ no API key — /api set <key>", C.red));
  console.log(c(`  ${config.workspace.replace(process.env.HOME || "", "~")}`, C.gray));
  console.log("");
  console.log(c("  /help", C.gray) + c(" · ", C.dim) + c("/model", C.gray) + c(" · ", C.dim) + c("@file", C.gray) + c(" · ", C.dim) + c("!cmd", C.gray) + c(" · ", C.dim) + c("/agent", C.gray));
  console.log("");

  // ── Readline ──
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => { rl.setPrompt(c("bloxcode", C.cyan) + c(" > ", C.green)); rl.prompt(); };

  prompt();

  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) { prompt(); continue; }

    // ═══ Commands ═══
    if (line === "/exit" || line === "/quit") break;

    if (line === "/help") {
      console.log("");
      const cmds: [string, string][] = [
        ["/api set <key>", "Set OpenRouter key"],
        ["/api show", "Show current key"],
        ["/api url <url>", "Change API base URL"],
        ["/model <slug>", "Set model"],
        ["/model", "Show current"],
        ["/mode <m>", "suggest/autoedit/fullauto/plan/scout"],
        ["/agent <task>", "Multi-agent orchestrator"],
        ["/agents", "Agent stats"],
        ["/tools", "All available tools"],
        ["/clear", "Clear context"],
        ["/mcp add <n> <cmd>", "Add MCP server"],
        ["/mcp remove <n>", "Remove MCP server"],
        ["/mcp", "MCP status"],
        ["@file msg", "Attach file to context"],
        ["!command", "Shell (add to context)"],
        ["!!command", "Shell (silent)"],
        ["/exit", "Quit"],
      ];
      for (const [cmd, desc] of cmds) console.log(`  ${c(cmd.padEnd(24), C.cyan)}${c(desc, C.gray)}`);
      console.log("");
      prompt(); continue;
    }

    if (line.startsWith("/api set ")) {
      config.apiKey = line.slice(9).trim();
      llm.setApiKey(config.apiKey);
      await saveConfig(config);
      console.log(c("  ✓ API key saved", C.green));
      prompt(); continue;
    }
    if (line === "/api set" || line === "/api") {
      const key = await ask(rl, c("  paste key: ", C.yellow));
      if (key.trim()) { config.apiKey = key.trim(); llm.setApiKey(config.apiKey); await saveConfig(config); console.log(c("  ✓ saved", C.green)); }
      prompt(); continue;
    }
    if (line === "/api show") {
      const k = config.apiKey;
      console.log(k ? `  ${c("key:", C.cyan)} ${k.slice(0, 10)}...${k.slice(-4)}` : c("  no key set", C.red));
      console.log(`  ${c("url:", C.cyan)} ${config.apiBaseUrl}`);
      prompt(); continue;
    }
    if (line.startsWith("/api url ")) {
      config.apiBaseUrl = line.slice(9).trim().replace(/\/+$/, "");
      llm.setBaseUrl(config.apiBaseUrl);
      await saveConfig(config);
      console.log(c(`  ✓ url: ${config.apiBaseUrl}`, C.green));
      prompt(); continue;
    }
    if (line.startsWith("/model ")) {
      config.model = line.slice(7).trim();
      await saveConfig(config);
      console.log(c(`  ✓ model: ${config.model}`, C.green));
      prompt(); continue;
    }
    if (line === "/model") {
      console.log(`  ${c("model:", C.cyan)} ${config.model}`);
      prompt(); continue;
    }
    if (line.startsWith("/mode ")) {
      config.mode = line.slice(6).trim();
      await saveConfig(config);
      messages[0] = { role: "system", content: systemPrompt(config, VERSION) };
      console.log(c(`  ✓ mode: ${config.mode}`, C.green));
      prompt(); continue;
    }
    if (line === "/tools") {
      console.log("");
      const tools = getAllTools();
      let lastCat = "";
      for (const t of tools) {
        if (t.category !== lastCat) { console.log(c(`  ${t.category}`, C.white, C.bold)); lastCat = t.category; }
        console.log(`    ${c(t.name.padEnd(16), C.cyan)}${c(t.description, C.gray)}`);
      }
      console.log("");
      prompt(); continue;
    }
    if (line === "/clear") {
      messages.length = 1;
      console.log(c("  ✓ cleared", C.green));
      prompt(); continue;
    }
    if (line.startsWith("/agent ")) {
      const task = line.slice(7).trim();
      if (!task) { console.log(c("  usage: /agent <task>", C.yellow)); prompt(); continue; }
      if (!config.apiKey) { console.log(c("  ⚠ set API key first", C.red)); prompt(); continue; }
      console.log(c("  ● orchestrating...", C.magenta));
      const result = await agents.execute(task, llm, config.model);
      for (const r of result.results) {
        const icon = r.ok ? c("✓", C.green) : c("✗", C.red);
        console.log(`  ${icon} ${c(`[${r.agent}]`, C.cyan)} ${(r.content || r.error || "").slice(0, 200)}`);
      }
      prompt(); continue;
    }
    if (line === "/agents") {
      console.log("");
      for (const [name, agent] of agents.agents) {
        console.log(`  ${c(name.padEnd(12), C.cyan)}${c(agent.config.role, C.gray)}`);
      }
      console.log("");
      prompt(); continue;
    }
    if (line.startsWith("/mcp add ")) {
      const parts = line.slice(9).trim().split(/\s+/);
      const name = parts[0], command = parts[1], args = parts.slice(2);
      if (!name || !command) { console.log(c("  usage: /mcp add <name> <command> [args]", C.yellow)); prompt(); continue; }
      console.log(c(`  starting ${name}...`, C.gray));
      const r = await mcp.start({ name, command, args, env: {} }, config.workspace);
      console.log(r.ok ? c(`  ✓ ${name}: ${r.tools} tools`, C.green) : c(`  ✗ ${r.error}`, C.red));
      messages[0] = { role: "system", content: systemPrompt(config, VERSION) };
      prompt(); continue;
    }
    if (line.startsWith("/mcp remove ")) {
      await mcp.stop(line.slice(12).trim());
      console.log(c("  ✓ removed", C.green));
      prompt(); continue;
    }
    if (line === "/mcp") {
      const status = mcp.getStatus();
      if (!status.length) { console.log(c("  no MCP servers", C.gray)); }
      else { for (const s of status) console.log(`  ${c(s.name.padEnd(16), C.cyan)}${s.running ? c("● running", C.green) : c("○ stopped", C.gray)} ${c(`${s.tools} tools`, C.gray)}`); }
      prompt(); continue;
    }

    // ═══ Shortcuts ═══
    if (line.startsWith("!")) {
      const silent = line.startsWith("!!");
      const cmd = line.slice(silent ? 2 : 1).trim();
      if (cmd) {
        const r = await runTool("shell", { command: cmd });
        const out = (r as any).stdout || (r as any).error || "";
        if (out) console.log(out);
        if (!silent && out) messages.push({ role: "user", content: `[shell: ${cmd}]\n${out}` });
      }
      prompt(); continue;
    }

    if (line.startsWith("/")) { console.log(c("  unknown command — /help", C.red)); prompt(); continue; }

    // ═══ Chat ═══
    if (!config.apiKey) { console.log(c("  ⚠ API key not set — /api set <key>", C.red)); prompt(); continue; }

    // @ file references
    let userContent = line;
    const refs = line.match(/@([\w.\/\-]+)/g);
    if (refs) {
      for (const ref of refs) {
        const filename = ref.slice(1);
        try {
          const { readFile } = await import("node:fs/promises");
          const path = await import("node:path");
          const content = await readFile(path.default.resolve(config.workspace, filename), "utf8");
          userContent = userContent.replace(ref, "") + `\n\n[File: ${filename}]\n${content.slice(0, 12000)}`;
          console.log(c(`  📎 ${filename}`, C.gray));
        } catch { console.log(c(`  ⚠ ${filename} not found`, C.yellow)); }
      }
      userContent = userContent.trim();
    }

    messages.push({ role: "user", content: userContent });

    // Multi-step tool loop
    const MAX_LOOPS = 25;
    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      try {
        const result = await llm.stream(messages, config.model, (chunk) => {
          process.stdout.write(chunk);
        });

        if (result.wasStreamed) process.stdout.write("\n\n");

        // Parse response
        let parsed: any = null;
        if (result.isJson || !result.wasStreamed) {
          try { parsed = JSON.parse(result.content); } catch {
            const m = result.content.match(/\{[\s\S]*\}/);
            if (m) try { parsed = JSON.parse(m[0]); } catch {}
          }
        }

        if (!parsed) {
          // Plain text — already streamed or print now
          if (!result.wasStreamed) console.log(result.content + "\n");
          messages.push({ role: "assistant", content: result.content });
          break;
        }

        if (parsed.type === "final") {
          const text = parsed.content || "";
          if (!result.wasStreamed) console.log(text + "\n");
          messages.push({ role: "assistant", content: text });
          break;
        }

        if (parsed.type === "tool") {
          const name = parsed.tool;
          const toolResult = await runTool(name, parsed.args || {});
          const ok = (toolResult as any).ok !== false;
          console.log(`  ${c(name, C.cyan)} ${c("→", C.gray)} ${ok ? c("✓", C.green) : c("✗", C.red)}`);

          // Show brief output
          const out = JSON.stringify(toolResult, null, 2);
          const lines = out.split("\n");
          if (lines.length <= 5) { for (const l of lines) console.log(c(`  │ ${l}`, C.gray)); }
          else { for (const l of lines.slice(0, 3)) console.log(c(`  │ ${l}`, C.gray)); console.log(c(`  │ ... +${lines.length - 3} lines`, C.dim)); }

          messages.push({ role: "assistant", content: JSON.stringify(parsed) });
          messages.push({ role: "user", content: `TOOL_RESULT:\n${out.slice(0, 3000)}` });
          continue; // next loop iteration
        }

        // Unknown
        if (!result.wasStreamed) console.log(result.content + "\n");
        messages.push({ role: "assistant", content: result.content });
        break;
      } catch (err) {
        console.log(c(`  ✗ ${(err as Error).message}`, C.red));
        break;
      }
    }

    prompt();
  }

  mcp.stopAll();
  console.log(c("\n  ● goodbye\n", C.cyan));
  process.exit(0);
}

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise(resolve => rl.question(prompt, resolve));
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
