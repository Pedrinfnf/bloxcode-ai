// ═══════════════════════════════════════════════════════════════════════════════
// AGENT SYSTEM — Sub-agents with orchestrator
// ═══════════════════════════════════════════════════════════════════════════════

import type { ChatMessage, ToolResult } from "@bloxcode/common";
import { runTool } from "@bloxcode/common";
import { LLMClient } from "./llm.js";

export interface AgentConfig {
  name: string;
  role: string;
  systemPrompt: string;
  allowedTools: string[];
  maxToolLoops: number;
}

export class Agent {
  constructor(
    public config: AgentConfig,
    private llm: LLMClient,
    private model: string,
  ) {}

  async run(task: string, context: ChatMessage[] = []): Promise<{ ok: boolean; content?: string; error?: string }> {
    const messages: ChatMessage[] = [
      { role: "system", content: this.config.systemPrompt },
      ...context,
      { role: "user", content: task },
    ];

    for (let loop = 0; loop < this.config.maxToolLoops; loop++) {
      try {
        const result = await this.llm.stream(messages, this.model);
        const content = result.content;

        // Try parse as tool call
        let parsed: any;
        try { parsed = JSON.parse(content); } catch {
          try {
            const m = content.match(/\{[\s\S]*\}/);
            if (m) parsed = JSON.parse(m[0]);
          } catch {}
        }

        if (!parsed) return { ok: true, content };
        if (parsed.type === "final") return { ok: true, content: parsed.content || "" };

        if (parsed.type === "tool") {
          if (this.config.allowedTools.length && !this.config.allowedTools.includes(parsed.tool)) {
            return { ok: false, error: `Tool '${parsed.tool}' not allowed for ${this.config.name}` };
          }
          const toolResult = await runTool(parsed.tool, parsed.args || {});
          messages.push({ role: "assistant", content: JSON.stringify(parsed) });
          messages.push({ role: "user", content: `TOOL_RESULT:\n${JSON.stringify(toolResult).slice(0, 3000)}` });
          continue;
        }

        return { ok: true, content };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }
    return { ok: false, error: "Max tool loops reached" };
  }
}

export class Orchestrator {
  agents = new Map<string, Agent>();

  register(agent: Agent) { this.agents.set(agent.config.name, agent); }

  async execute(task: string, llm: LLMClient, model: string): Promise<{ ok: boolean; results: any[] }> {
    // Ask LLM to plan which agents to use
    const agentList = Array.from(this.agents.values())
      .map(a => `- ${a.config.name}: ${a.config.role}`)
      .join("\n");

    let plan: any;
    try {
      const planResult = await llm.chat([
        { role: "system", content: "Pick which agents to use. Return JSON only: {\"tasks\":[{\"agent\":\"name\",\"task\":\"subtask\"}]}" },
        { role: "user", content: `Task: ${task}\n\nAgents:\n${agentList}` },
      ], model);
      plan = JSON.parse(planResult.content);
    } catch {
      plan = { tasks: [{ agent: "Coder", task }] };
    }

    const results: any[] = [];
    for (const t of plan.tasks || []) {
      const agent = this.agents.get(t.agent) || this.agents.get("Coder");
      if (!agent) { results.push({ agent: t.agent, ok: false, error: "Not found" }); continue; }
      const result = await agent.run(t.task, results.filter(r => r.ok).map(r => ({
        role: "user" as const, content: `Previous [${r.agent}]: ${JSON.stringify(r.content || "").slice(0, 2000)}`
      })));
      results.push({ agent: t.agent, ...result });
      if (!result.ok) break;
    }

    return { ok: results.every(r => r.ok), results };
  }
}

export function createDefaultAgents(llm: LLMClient, model: string): Orchestrator {
  const orch = new Orchestrator();

  const make = (name: string, role: string, prompt: string, tools: string[], loops = 15) =>
    new Agent({ name, role, systemPrompt: prompt, allowedTools: tools, maxToolLoops: loops }, llm, model);

  orch.register(make("Coder", "Creates and edits code",
    `You are Coder. Read files before editing. Use tools to complete tasks. Respond with JSON: {"type":"tool","tool":"name","args":{}} or {"type":"final","content":"result"}`,
    ["cat", "write", "edit", "apply_patch", "multi_write", "shell", "tree", "ls", "find", "grep", "test"], 20));

  orch.register(make("Reviewer", "Reviews code for bugs",
    `You are Reviewer. Analyze code quality. Only report issues with confidence >= 80. JSON: type:tool or type:final.`,
    ["cat", "grep", "find", "shell", "tree", "ls"], 10));

  orch.register(make("Researcher", "Searches web and docs",
    `You are Researcher. Search web, fetch URLs, find documentation. JSON: type:tool or type:final.`,
    ["fetch", "search", "sourcegraph", "shell", "cat", "find", "grep"], 8));

  orch.register(make("Tester", "Writes and runs tests",
    `You are Tester. Write and run tests. JSON: type:tool or type:final.`,
    ["cat", "write", "shell", "test", "find", "grep", "edit"], 15));

  orch.register(make("DevOps", "Git, Docker, CI/CD",
    `You are DevOps. Manage git, docker, CI/CD. JSON: type:tool or type:final.`,
    ["shell", "gitStatus", "gitDiff", "gitCommit", "gitBranch", "gitStash", "gitLog", "docker", "pipeline", "pkg", "cat", "write"], 10));

  return orch;
}
