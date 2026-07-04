// ═══════════════════════════════════════════════════════════════════════════════
// SUB-AGENT SYSTEM (inspired by Claude Code sub-agents + Codex skills)
// Each agent has: name, role, system prompt, allowed tools, color
// Orchestrator plans and delegates tasks across agents
// ═══════════════════════════════════════════════════════════════════════════════

import { _, S } from "../core/ansi.js";
import { drawBox, drawTable, startSpin, stopSpin } from "../tui/box.js";
import { router } from "../providers/router.js";
import { streamChat, chatAI, extractJson, estimateCost } from "../providers/api.js";
import { runTool } from "../tools/registry.js";

export class Agent {
  constructor(name, role, systemPrompt, allowedTools = [], color = _.c) {
    this.name = name;
    this.role = role;
    this.systemPrompt = systemPrompt;
    this.allowedTools = allowedTools;
    this.color = color;
    this.totalTokens = 0;
    this.totalCost = 0;
    this.calls = 0;
  }

  async run(task, context = []) {
    this.calls++;
    const messages = [
      { role: "system", content: this.systemPrompt },
      ...context,
      { role: "user", content: task },
    ];

    console.log(S(`\n🤖 [${this.name}] ${this.role}`, this.color, _.b));
    console.log(S(`   Tarefa: ${task.slice(0, 100)}…`, _.d));

    const route = router.selectModel(task);
    let modelToUse = route.model;
    let attempts = 0;

    while (attempts < 5) {
      attempts++;
      try {
        const result = await streamChat(messages, modelToUse);
        const content = result.content;
        this.totalTokens += result.usage?.total_tokens || 0;
        this.totalCost += estimateCost(modelToUse, result.usage).total;

        let parsed;
        try { parsed = extractJson(content); } catch { return { ok: true, content, type: "text" }; }

        if (parsed.type === "final") return { ok: true, content: parsed.content, type: "final" };

        if (parsed.type === "tool") {
          if (this.allowedTools.length > 0 && !this.allowedTools.includes(parsed.tool)) {
            return { ok: false, error: `Tool '${parsed.tool}' não permitida para ${this.name}`, content };
          }
          const toolResult = await runTool(parsed.tool, parsed.args || {});
          return { ok: true, tool: parsed.tool, args: parsed.args, result: toolResult, type: "tool" };
        }

        return { ok: true, content, type: "raw" };
      } catch (err) {
        if (attempts < 4) {
          const candidates = router.favorites[route.task] || router.favorites.default;
          const idx = candidates.indexOf(modelToUse);
          if (idx >= 0 && idx < candidates.length - 1) modelToUse = candidates[idx + 1];
          continue;
        }
        return { ok: false, error: err.message };
      }
    }
    return { ok: false, error: "Max attempts" };
  }
}

export class Orchestrator {
  constructor() {
    this.agents = {};
    this.log = [];
  }

  register(agent) {
    this.agents[agent.name] = agent;
  }

  async execute(userTask) {
    console.log(drawBox([
      S("  🎯 ORCHESTRATOR — Planejando execução", _.M, _.b),
    ], { title: S("MULTI-AGENT", _.M), color: _.M, w: 60, double: true }));

    const agentList = Object.values(this.agents).map(a => `- ${a.name}: ${a.role}`).join("\n");
    const planningPrompt = `Tarefa: ${userTask}\n\nAgentes:\n${agentList}\n\nJSON: {"tasks":[{"agent":"name","task":"sub-tarefa"}],"reason":"motivo"}`;

    let plan;
    try {
      const planResult = await chatAI([
        { role: "system", content: "Decida qual agente(s) usar. Retorne JSON puro." },
        { role: "user", content: planningPrompt },
      ], "nvidia/nemotron-3-ultra-550b-a55b:free");
      plan = extractJson(planResult.choices?.[0]?.message?.content || "");
    } catch {
      plan = { tasks: [{ agent: "Coder", task: userTask }], reason: "Fallback direto" };
    }

    console.log(S(`\n📋 Plano: ${plan.reason || "Direto"}`, _.m));
    for (const t of (plan.tasks || [])) {
      console.log(S(`   ▶️ [${t.agent}] ${t.task.slice(0, 80)}`, _.d));
    }

    const results = [];
    for (const t of (plan.tasks || [])) {
      const agent = this.agents[t.agent] || this.agents["Coder"];
      if (!agent) { results.push({ agent: t.agent, ok: false, error: "Agente não encontrado" }); continue; }

      const ctx = results.filter(r => r.ok).map(r => ({
        role: "user",
        content: `Resultado [${r.agent}]: ${JSON.stringify(r.result || r.content || "").slice(0, 2000)}`,
      }));

      const result = await agent.run(t.task, ctx);
      results.push({ agent: t.agent, ...result });
      this.log.push({ agent: t.agent, task: t.task, result, time: Date.now() });

      if (!result.ok) {
        console.log(S(`\n❌ [${t.agent}] ${result.error}`, _.r));
        break;
      }
    }

    const ok = results.every(r => r.ok);
    console.log(S(`\n${ok ? "✅" : "⚠️"} ${results.filter(r => r.ok).length}/${results.length} agentes OK`, ok ? _.Gr : _.y));
    return { ok, results, plan };
  }

  getStats() {
    const s = {};
    for (const [n, a] of Object.entries(this.agents)) {
      s[n] = { calls: a.calls, tokens: a.totalTokens, cost: a.totalCost };
    }
    return s;
  }

  printStats() {
    const stats = this.getStats();
    const rows = Object.entries(stats).map(([name, s]) => [
      name,
      `${S(String(s.calls), _.y)} calls | ${S(String(s.tokens), _.c)} tk | $${S(s.cost.toFixed(6), _.b)}`,
    ]);
    console.log(drawTable(rows, { title: "🤖 SUB-AGENTS STATS", color: _.M, w: 76 }));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT AGENTS
// ═══════════════════════════════════════════════════════════════════════════════

export function createDefaultOrchestrator() {
  const orch = new Orchestrator();

  orch.register(new Agent("Coder", "Cria e edita código",
    `Você é o Coder. Crie, edite e refatore código. Sempre leia (cat) antes de editar.
Responda com JSON: {"type":"tool","tool":"name","args":{}} para executar ferramentas
ou {"type":"final","content":"resultado"} para resposta final.`,
    ["cat", "write", "edit", "apply_patch", "multi_write", "shell", "tree", "ls", "find", "grep"], _.Gr));

  orch.register(new Agent("Reviewer", "Analisa código e encontra bugs",
    `Você é o Reviewer. Analise código, encontre bugs, sugira melhorias.
Responda com JSON: type:tool ou type:final.`,
    ["cat", "grep", "find", "shell", "tree", "ls"], _.y));

  orch.register(new Agent("Researcher", "Pesquisa web e documentação",
    `Você é o Researcher. Busque documentação, exemplos, soluções.
Responda com JSON: type:tool ou type:final.`,
    ["fetch", "sourcegraph", "search", "shell", "cat", "find", "grep"], _.c));

  orch.register(new Agent("Tester", "Escreve e roda testes",
    `Você é o Tester. Escreva e rode testes unitários e de integração.
Responda com JSON: type:tool ou type:final.`,
    ["cat", "write", "shell", "test", "find", "grep"], _.m));

  orch.register(new Agent("DevOps", "Git, Docker, CI/CD",
    `Você é o DevOps. Gerencie git, docker, CI/CD, deploy, pipelines.
Responda com JSON: type:tool ou type:final.`,
    ["shell", "gitStatus", "gitDiff", "gitCommit", "gitBranch", "gitStash", "gitLog", "docker", "pipeline", "pkg", "cat", "write", "find"], _.e));

  return orch;
}
