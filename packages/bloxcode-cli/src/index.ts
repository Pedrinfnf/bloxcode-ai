#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// BLOXCODE CLI — Main entry point (TypeScript)
// ═══════════════════════════════════════════════════════════════════════════════

import readline from "node:readline";
import { LLMClient, createDefaultAgents, MCPClient, registerBuiltinTools } from "@bloxcode/agent";
import { getToolDescriptions, runTool, getAllTools } from "@bloxcode/common";
import type { ChatMessage } from "@bloxcode/common";
import { loadConfig, saveConfig, type AppConfig } from "./config.js";
import { systemPrompt } from "./prompt.js";

const VERSION = "0.1.0";

async function main() {
  const config = await loadConfig();
  const llm = new LLMClient(config.apiKey, config.apiBaseUrl);
  const mcp = new MCPClient();

  registerBuiltinTools();

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(config, VERSION) },
  ];

  // Banner
  console.log("");
  console.log(`  \x1b[36m\x1b[1m● bloxcode\x1b[0m`);
  console.log(`  \x1b[90mv${VERSION}\x1b[0m\x1b[90m · \x1b[0m\x1b[36m${config.model.split("/").pop()}\x1b[0m\x1b[90m · \x1b[0m\x1b[33m${config.mode}\x1b[0m`);
  if (!config.apiKey) console.log("  \x1b[31m⚠ no API key — /api set <key>\x1b[0m");
  console.log(`  \x1b[90m${config.workspace}\x1b[0m`);
  console.log("");
  console.log("  \x1b[90m/help · /model · /agent · @file · !cmd\x1b[0m");
  console.log("");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => {
    rl.setPrompt(`\x1b[36mbloxcode\x1b[0m \x1b[32m>\x1b[0m `);
    rl.prompt();
  };

  prompt();

  for await (const input of rl) {
    const line = input.trim();
    if (!line) { prompt(); continue; }

    // ── Commands ──
    if (line === "/exit" || line === "/quit") break;

    if (line === "/help") {
      const cmds = [
        ["/api set <key>", "Set OpenRouter API key"],
        ["/model <slug>", "Set model"],
        ["/model", "Show current model"],
        ["/agent <task>", "Run multi-agent"],
        ["/tools", "List all tools"],
        ["/mcp add <n> <cmd>", "Add MCP server"],
        ["/mcp", "MCP status"],
        ["/clear", "Clear context"],
        ["/exit", "Quit"],
        ["@file.ts msg", "Attach file"],
        ["!command", "Run shell"],
      ];
      console.log("");
      for (const [cmd, desc] of cmds) {
        console.log(`  \x1b[36m${cmd.padEnd(22)}\x1b[0m \x1b[90m${desc}\x1b[0m`);
      }
      console.log("");
      prompt(); continue;
    }

    if (line.startsWith("/api set ")) {
      config.apiKey = line.slice(9).trim();
      llm.setApiKey(config.apiKey);
      await saveConfig(config);
      console.log(`  \x1b[32m✓ API key saved\x1b[0m`);
      prompt(); continue;
    }

    if (line === "/tools") {
      const tools = getAllTools();
      console.log("");
      for (const t of tools) {
        console.log(`  \x1b[36m${t.name.padEnd(16)}\x1b[0m \x1b[90m${t.description}\x1b[0m`);
      }
      console.log("");
      prompt(); continue;
    }

    if (line === "/clear") {
      messages.length = 1; // keep system
      console.log("  \x1b[32m✓ cleared\x1b[0m");
      prompt(); continue;
    }

    if (line.startsWith("/model ")) {
      config.model = line.slice(7).trim();
      await saveConfig(config);
      console.log(`  \x1b[32m✓ model: ${config.model}\x1b[0m`);
      prompt(); continue;
    }

    if (line === "/model") {
      console.log(`  \x1b[36mmodel:\x1b[0m ${config.model}`);
      prompt(); continue;
    }

    if (line.startsWith("!")) {
      const cmd = line.slice(1).trim();
      if (cmd) {
        const result = await runTool("shell", { command: cmd });
        console.log((result as any).stdout || (result as any).error || "");
      }
      prompt(); continue;
    }

    // ── Chat ──
    if (!config.apiKey) {
      console.log("  \x1b[31m⚠ API key not set. Use /api set <key>\x1b[0m");
      prompt(); continue;
    }

    messages.push({ role: "user", content: line });

    try {
      const result = await llm.stream(messages, config.model, (chunk) => {
        process.stdout.write(chunk);
      });

      if (result.wasStreamed) process.stdout.write("\n\n");

      // Handle JSON responses
      if (result.isJson || !result.wasStreamed) {
        let parsed: any;
        try { parsed = JSON.parse(result.content); } catch {
          const m = result.content.match(/\{[\s\S]*\}/);
          if (m) try { parsed = JSON.parse(m[0]); } catch {}
        }

        if (parsed?.type === "final") {
          console.log((parsed.content || "") + "\n");
          messages.push({ role: "assistant", content: parsed.content || "" });
        } else if (parsed?.type === "tool") {
          const toolResult = await runTool(parsed.tool, parsed.args || {});
          console.log(`  \x1b[36m${parsed.tool}\x1b[0m \x1b[90m→\x1b[0m ${(toolResult as any).ok !== false ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"}`);
          messages.push({ role: "assistant", content: JSON.stringify(parsed) });
          messages.push({ role: "user", content: `TOOL_RESULT:\n${JSON.stringify(toolResult).slice(0, 3000)}` });
        } else if (!result.wasStreamed) {
          console.log(result.content + "\n");
          messages.push({ role: "assistant", content: result.content });
        }
      } else {
        messages.push({ role: "assistant", content: result.content });
      }
    } catch (err) {
      console.log(`  \x1b[31m✗ ${(err as Error).message}\x1b[0m\n`);
    }

    prompt();
  }

  mcp.stopAll();
  console.log("\n  \x1b[36m● goodbye\x1b[0m\n");
  process.exit(0);
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
