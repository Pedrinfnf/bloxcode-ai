# 🤖 BloxCode v4.0 — AI Terminal Agent

**Multi-file Architecture | Sub-Agents | Interactive TUI | MCP | Skills**

> Inspirado em **Codex CLI** (sandbox, modes) + **OpenCode** (TUI, multi-provider, dialogs) + **Claude Code** (sub-agents, skills, AGENTS.md)

---

## 🆕 O que mudou do v3.4 → v4.0

| Feature | v3.4 (arquivo único) | v4.0 (multi-file) |
|---|---|---|
| Arquitetura | 1 arquivo (2872 linhas) | 14 arquivos em 8 módulos (2501 linhas) |
| Seletor de modelo | `/model set slug` (texto) | `/model` → **seletor interativo ↑↓** com busca em tempo real |
| Comandos | Digitados no chat | **Tab-completion** + dialogs interativos estilo OpenCode |
| Sub-agentes | Básico | 5 agentes (Coder, Reviewer, Researcher, Tester, DevOps) com orquestrador |
| MCP | Básico | Cliente MCP completo com add/remove/status/tools |
| Skills | SKILL.md | SKILL.md + AGENTS.md + CLAUDE.md (compatível com Claude Code) |
| Confirmações | ask() simples | Dialogs interativos com confirm(), textInput(), selectFromList() |
| Streaming | OK | Streaming com reasoning display (💭) |
| Editabilidade | Impossível | Cada módulo em arquivo separado, fácil de editar e estender |

---

## 📁 Estrutura do Projeto

```
bloxcode-v4/
├── bin/
│   └── cli.js              # Entry point (shebang)
├── src/
│   ├── index.js             # Main app, command loop, system prompt
│   ├── core/
│   │   └── ansi.js          # ANSI colors, text utilities
│   ├── config/
│   │   └── state.js         # State, config, modes, profiles, history, aliases, skills
│   ├── tui/
│   │   ├── box.js           # Box drawing, tables, progress bar, spinner
│   │   └── dialogs.js       # Interactive dialogs: list selector (↑↓), confirm, input
│   ├── providers/
│   │   ├── router.js        # Smart model router, favorites, interactive selector
│   │   └── api.js           # OpenRouter API, streaming, JSON extraction, cost
│   ├── tools/
│   │   ├── registry.js      # Tool registry (central)
│   │   ├── files.js         # File ops: cat, write, edit, patch, find, grep, tree
│   │   ├── shell.js         # Shell, git, test, docker, pipeline, pkg
│   │   └── web.js           # Web search, fetch, image gen, sourcegraph
│   ├── agents/
│   │   └── agent.js         # Sub-agent system, orchestrator
│   └── mcp/
│       └── client.js        # MCP client (JSON-RPC)
├── package.json
└── README.md
```

---

## 🚀 Instalação

```bash
# Clone ou copie a pasta bloxcode-v4/
cd bloxcode-v4

# Configure a API key
export OPENROUTER_API_KEY='sk-or-...'

# Execute
node bin/cli.js
```

**Sem dependências externas!** Usa apenas Node.js 18+ built-in modules.

---

## 🎮 Comandos Principais

### Core
| Comando | Descrição |
|---|---|
| `/help` | Ajuda completa |
| `/exit` | Sair |
| `/clear` | Limpa contexto |
| `/compact` | Compacta contexto (auto-resumo) |
| `/stats` | Dashboard da sessão |

### 🤖 Modelos (Interativo!)
| Comando | Descrição |
|---|---|
| **`/model`** | **Seletor interativo ↑↓ com busca** (como OpenCode!) |
| `/model set <slug>` | Define modelo manual |
| `/model auto` | Ativa auto-router |
| `/model favorites` | Favoritos por categoria |
| `/model benchmark` | Testa velocidade |

### 🎮 Modos (como Codex CLI)
| Comando | Descrição |
|---|---|
| `/mode suggest` | Sugere mas não executa |
| `/mode autoedit` | Edita sem confirmar |
| `/mode fullauto` | Executa tudo sem confirmar |
| `/mode plan` | Planeja antes de executar (multi-step) |
| `/mode scout` | Pesquisa repo antes de responder |

### 🤖 Sub-Agentes (como Claude Code)
| Comando | Descrição |
|---|---|
| `/agent <tarefa>` | Orquestrador multi-agente |
| `/agents` | Stats dos agentes |

### 🔌 MCP
| Comando | Descrição |
|---|---|
| `/mcp status` | Status dos MCP servers |
| `/mcp <server> <tool>` | Chama tool MCP |

---

## 🏗️ Arquitetura Comparada

### vs OpenCode
- ✅ Seletor interativo de modelos com ↑↓ + busca (inspirado no `/model` Ctrl+L)
- ✅ Módulos separados (como o Go `internal/` do OpenCode)
- ✅ Conventions support (AGENTS.md, .bloxcode.md)
- ✅ Tool registry centralizado (como `tools/tools.go`)

### vs Codex CLI
- ✅ Modes: suggest/auto-edit/full-auto (mesmo conceito)
- ✅ Approval profiles: safe/edit/full (como sandbox levels)
- ✅ Skills system (como `.codex/skills/`)
- ✅ Sub-agent orchestration

### vs Claude Code
- ✅ Sub-agents com orquestrador (Coder, Reviewer, Researcher, Tester, DevOps)
- ✅ MCP client
- ✅ CLAUDE.md/AGENTS.md support
- ✅ Patch com SEARCH/REPLACE format

---

## 📦 Ferramentas NPM Úteis para AI Agents

Pesquisei as melhores ferramentas do ecossistema em 2026:

| Pacote | Uso |
|---|---|
| `@anthropic-ai/claude-code` | Claude Code CLI (referência) |
| `@openai/codex` | OpenAI Codex CLI (referência) |
| `@continuedev/cli` | Continue CLI agent |
| `@mariozechner/pi-coding-agent` | Pi coding agent (TypeScript, leve) |
| `@modelcontextprotocol/sdk` | SDK oficial do MCP |
| `repomix` | Empacota repo inteiro em 1 arquivo para AI |
| `cline` | Cline CLI agent |
| `aider-chat` (pip) | Aider - Git-native AI coding |

---

## 🔧 Como Estender

### Adicionar nova tool
Edite `src/tools/registry.js`:
```js
import { minhaNovaFuncao } from "./meu-modulo.js";
// No TOOLS object:
minhaTool: { fn: minhaNovaFuncao, desc: "Descrição", args: ["arg1"] },
```

### Adicionar novo agente
Edite `src/agents/agent.js`:
```js
orch.register(new Agent("MeuAgente", "Faz X", "System prompt...", ["tool1", "tool2"], _.Gr));
```

### Adicionar MCP server
Crie `.bloxcode/mcp.json`:
```json
{
  "notion": {
    "command": "npx",
    "args": ["@notionhq/mcp-server"],
    "env": { "NOTION_API_KEY": "..." }
  }
}
```

---

## 📊 Contagem de Linhas por Módulo

| Módulo | Arquivo | Linhas | Responsabilidade |
|---|---|---|---|
| Entry | `bin/cli.js` | 13 | Bootstrap |
| Core | `src/core/ansi.js` | 48 | Cores, texto |
| Config | `src/config/state.js` | 202 | Estado, persistência |
| TUI | `src/tui/box.js` | 114 | Box drawing, spinner |
| TUI | `src/tui/dialogs.js` | 170 | Dialogs interativos |
| Providers | `src/providers/router.js` | 220 | Smart router |
| Providers | `src/providers/api.js` | 174 | API, streaming |
| Tools | `src/tools/files.js` | 322 | File operations |
| Tools | `src/tools/shell.js` | 149 | Shell, git, docker |
| Tools | `src/tools/web.js` | 90 | Web search, fetch |
| Tools | `src/tools/registry.js` | 84 | Tool registry |
| Agents | `src/agents/agent.js` | 187 | Sub-agents |
| MCP | `src/mcp/client.js` | 176 | MCP protocol |
| Main | `src/index.js` | 552 | App loop, commands |
| **Total** | **14 files** | **~2501** | |

---

*BloxCode v4.0 — Built with ❤️ inspired by the best: Codex CLI, OpenCode, Claude Code*
