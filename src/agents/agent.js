// ═══════════════════════════════════════════════════════════════════════════════
// SUB-AGENT SYSTEM v4.2 — Inspired by Claude Code's plugin agents
// Now with: multi-step tool loops, parallel agents, confidence scoring,
// phase-based workflows (like Claude Code's feature-dev plugin)
// ═══════════════════════════════════════════════════════════════════════════════

import { _, S } from "../core/ansi.js";
import { drawBox, drawTable, startSpin, stopSpin } from "../tui/box.js";
import { router } from "../providers/router.js";
import { streamChat, chatAI, extractJson, estimateCost } from "../providers/api.js";
import { runTool } from "../tools/registry.js";

export class Agent {
  constructor(name, role, systemPrompt, allowedTools = [], color = _.c, opts = {}) {
    this.name = name;
    this.role = role;
    this.systemPrompt = systemPrompt;
    this.allowedTools = allowedTools;
    this.color = color;
    this.model = opts.model || null; // null = use router
    this.maxToolLoops = opts.maxToolLoops || 15; // multi-step: keep going until final
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
    console.log(S(`   Tarefa: ${task.slice(0, 120)}`, _.d));

    const route = router.selectModel(task);
    let modelToUse = this.model || route.model;

    // ── Multi-step tool loop (like Claude Code) ──
    // Agent keeps calling tools until it returns type:final or hits max loops
    for (let loop = 0; loop < this.maxToolLoops; loop++) {
      let attempts = 0;
      while (attempts < 3) {
        attempts++;
        try {
          const result = await streamChat(messages, modelToUse);
          const content = result.content;
          this.totalTokens += result.usage?.total_tokens || 0;
          this.totalCost += estimateCost(modelToUse, result.usage).total;

          // Not JSON? That's the final answer
          let parsed;
          try { parsed = extractJson(content); }
          catch { return { ok: true, content, type: "text" }; }

          if (parsed.type === "final") {
            return { ok: true, content: parsed.content, type: "final" };
          }

          if (parsed.type === "tool") {
            if (this.allowedTools.length > 0 && !this.allowedTools.includes(parsed.tool)) {
              return { ok: false, error: `Tool '${parsed.tool}' não permitida para ${this.name}` };
            }
            const toolResult = await runTool(parsed.tool, parsed.args || {});

            // Show tool result
            console.log(`  ${S("⚙️", _.d)} ${S(parsed.tool, _.c)} → ${S(toolResult.ok !== false ? "OK" : "FAIL", toolResult.ok !== false ? _.Gr : _.r)}`);

            // Feed result back and continue the loop
            messages.push({ role: "assistant", content: JSON.stringify(parsed) });
            messages.push({ role: "user", content: `TOOL_RESULT:\n${JSON.stringify(toolResult, null, 2).slice(0, 3000)}` });
            break; // break attempts, continue tool loop
          }

          // Unknown type — treat as final
          return { ok: true, content, type: "raw" };
        } catch (err) {
          if (attempts < 3) {
            const candidates = router.favorites[route.task] || router.favorites.default;
            const idx = candidates.indexOf(modelToUse);
            if (idx >= 0 && idx < candidates.length - 1) modelToUse = candidates[idx + 1];
            continue;
          }
          return { ok: false, error: err.message };
        }
      }
    }
    return { ok: false, error: `Max tool loops (${this.maxToolLoops}) reached` };
  }
}

export class Orchestrator {
  constructor() { this.agents = {}; this.log = []; }
  register(agent) { this.agents[agent.name] = agent; }

  async execute(userTask) {
    console.log(drawBox([
      S("  🎯 ORCHESTRATOR — Planejando execução", _.M, _.b),
    ], { title: S("MULTI-AGENT", _.M), color: _.M, w: 60, double: true }));

    const agentList = Object.values(this.agents).map(a =>
      `- ${a.name}: ${a.role} (tools: ${a.allowedTools.slice(0, 5).join(",")}${a.allowedTools.length > 5 ? "..." : ""})`
    ).join("\n");

    const planningPrompt = `Tarefa do usuário: ${userTask}

Agentes disponíveis:
${agentList}

Analise a tarefa e decida quais agentes usar e em que ordem.
Se a tarefa envolve código, comece com Coder.
Se precisa pesquisa, use Researcher.
Se é complexo, use múltiplos agentes em sequência.

Responda APENAS com JSON:
{"tasks":[{"agent":"NomeDoAgente","task":"sub-tarefa detalhada"}],"reason":"explicação curta","parallel":false}`;

    let plan;
    try {
      startSpin("Planejando");
      const planResult = await chatAI([
        { role: "system", content: "Você é um orquestrador. Retorne APENAS JSON puro, sem markdown, sem explicação." },
        { role: "user", content: planningPrompt },
      ], router.selectModel(userTask).model);
      stopSpin();
      plan = extractJson(planResult.choices?.[0]?.message?.content || "");
    } catch {
      stopSpin();
      plan = { tasks: [{ agent: "Coder", task: userTask }], reason: "Fallback direto" };
    }

    console.log(S(`\n📋 Plano: ${plan.reason || "Direto"}`, _.m));
    for (const t of (plan.tasks || [])) {
      console.log(S(`   ▶️ [${t.agent}] ${(t.task || "").slice(0, 80)}`, _.d));
    }

    const results = [];
    for (const t of (plan.tasks || [])) {
      const agent = this.agents[t.agent] || this.agents["Coder"];
      if (!agent) { results.push({ agent: t.agent, ok: false, error: "Agente não encontrado" }); continue; }

      // Pass previous results as context
      const ctx = results.filter(r => r.ok).map(r => ({
        role: "user",
        content: `Resultado anterior [${r.agent}]: ${JSON.stringify(r.result || r.content || "").slice(0, 3000)}`,
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
    for (const [n, a] of Object.entries(this.agents))
      s[n] = { calls: a.calls, tokens: a.totalTokens, cost: a.totalCost };
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
// DEFAULT AGENTS — Inspired by Claude Code's plugin agents
// Each has a detailed system prompt like Claude Code's agent .md files
// ═══════════════════════════════════════════════════════════════════════════════

export function createDefaultOrchestrator() {
  const orch = new Orchestrator();

  orch.register(new Agent("Coder", "Cria, edita e refatora código",
`Você é o Coder, um engenheiro senior especializado em criar e editar código.

## Processo
1. SEMPRE leia o arquivo (cat) antes de editar
2. Entenda o contexto e padrões existentes
3. Faça mudanças mínimas e cirúrgicas
4. Siga as convenções do projeto

## Regras
- Leia arquivos relevantes ANTES de qualquer edição
- Use edit/apply_patch para mudanças em arquivos existentes
- Use write para arquivos novos
- Use shell para rodar testes/lint após mudanças
- Mantenha backups implícitos

## Output
Responda com JSON:
- {"type":"tool","tool":"nome","args":{...}} para executar ferramentas
- {"type":"final","content":"resultado"} quando terminar

Você pode fazer MÚLTIPLAS chamadas de ferramentas em sequência. Continue até terminar a tarefa.`,
    ["cat", "write", "edit", "apply_patch", "multi_write", "shell", "tree", "ls", "find", "grep", "test"],
    _.Gr, { maxToolLoops: 20 }));

  orch.register(new Agent("Reviewer", "Analisa código, encontra bugs e sugere melhorias",
`Você é o Reviewer, um expert em code review com foco em qualidade.

## Processo (inspirado no Claude Code code-reviewer)
1. Leia o código com cat
2. Busque padrões problemáticos com grep
3. Verifique a árvore do projeto com tree
4. Analise cada issue com confidence score (0-100)

## Output
Só reporte issues com confidence >= 80.
Para cada issue:
- Descrição clara
- Arquivo e linha
- Sugestão de fix
- Score de confiança

Agrupe: Critical (90-100), Important (80-89).
Se não houver issues, confirme que está OK.

JSON: type:tool para ferramentas, type:final para resultado.`,
    ["cat", "grep", "find", "shell", "tree", "ls"], _.y, { maxToolLoops: 10 }));

  orch.register(new Agent("Researcher", "Pesquisa web, documentação e código",
`Você é o Researcher, especializado em buscar informações.

## Capacidades
- Buscar na web (search)
- Buscar código no Sourcegraph (sourcegraph)
- Buscar URLs (fetch)
- Ler arquivos locais (cat, grep, find)

## Processo
1. Entenda a pergunta
2. Busque na web se necessário
3. Busque código se relevante
4. Compile resultados em resposta clara

JSON: type:tool para ferramentas, type:final para resultado.`,
    ["fetch", "sourcegraph", "search", "shell", "cat", "find", "grep"],
    _.c, { maxToolLoops: 8 }));

  orch.register(new Agent("Tester", "Escreve e roda testes",
`Você é o Tester, especializado em qualidade e testes.

## Processo
1. Leia o código a ser testado (cat)
2. Identifique o framework de teste (find)
3. Escreva testes (write)
4. Rode os testes (shell/test)
5. Se falhar, corrija e rode novamente

JSON: type:tool para ferramentas, type:final para resultado.`,
    ["cat", "write", "shell", "test", "find", "grep", "edit"],
    _.m, { maxToolLoops: 15 }));

  orch.register(new Agent("DevOps", "Git, Docker, CI/CD, deploy",
`Você é o DevOps, especializado em infra e automação.

## Capacidades
- Git (gitStatus, gitDiff, gitCommit, gitBranch, gitStash, gitLog)
- Docker (docker)
- Pipelines (pipeline)
- Package managers (pkg)

## Processo (inspirado no Claude Code commit-commands)
- Para commits: analise o diff, crie mensagem descritiva, faça add+commit
- Para deploy: verifique status, rode testes, depois deploy

JSON: type:tool para ferramentas, type:final para resultado.`,
    ["shell", "gitStatus", "gitDiff", "gitCommit", "gitBranch", "gitStash", "gitLog",
     "docker", "pipeline", "pkg", "cat", "write", "find"],
    _.e, { maxToolLoops: 10 }));

  return orch;
}
