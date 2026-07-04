# bloxcode

AI coding agent for the terminal. Zero dependencies. Built for Termux.

```
  ● bloxcode
  v0.0.12 · Nemotron Ultra 550B 🆓⭐ · suggest
  ~/my-project

  /help commands · /model switch · @file attach · !cmd shell

[░░░░░░░░░░░░░░░] 0% of 1M bloxcode >
```

## Install

```bash
npm install -g github:Pedrinfnf/bloxcode-ai
```

## Run

```bash
bloxcode
```

First time setup:
```
bloxcode > /api set sk-or-v1-your-openrouter-key
```

Get your key at [openrouter.ai/keys](https://openrouter.ai/keys) — free models available.

## Features

**Chat with AI** — talk naturally, it reads/writes/runs code for you

**Multi-step tool calls** — one prompt can do `read → edit → test → commit` automatically (up to 25 chained calls)

**5 sub-agents** — `/agent refactor this module` runs Coder, Reviewer, Tester in sequence

**MCP servers** — connect external tools that the AI can use:
```
/mcp add github npx @modelcontextprotocol/server-github
/mcp add memory npx @modelcontextprotocol/server-memory
```

**Smart model router** — auto-picks best model per task (code/reasoning/chat/search)

**Context tracking** — shows usage bar in prompt, auto-compacts at 75%

## Commands

```
General              API & Models              Modes
  /help                /api set <key>            /mode suggest
  /exit                /api show                 /mode autoedit
  /clear               /api url <url>            /mode fullauto
  /compact             /model                    /mode plan
  /stats               /model set <slug>         /mode scout
                       /model auto               /profile safe|edit|full
                       /model benchmark          /reasoning

Edit & Undo          Agents                    Shortcuts
  /undo                /agent <task>             @file.js <msg>
  /diff                /agents                   @a.js @b.js msg
  /retry                                         !command
  /snapshot save                                  !!command (silent)

Tools & Git          MCP                       Sessions
  /tools               /mcp                      /session save
  /exec <cmd>          /mcp add <n> <cmd>        /session list
  /test                /mcp remove <n>           /session load
  /search <q>                                    /session new
  /git status|diff|commit|branch|stash|log
```

## Built-in Tools

The AI can use these tools automatically:

| Category | Tools |
|----------|-------|
| **File System** | `cat`, `write`, `edit`, `apply_patch`, `find`, `grep`, `tree`, `ls` |
| **Shell** | `shell` (any command), `test`, `docker`, `pipeline`, `pkg` |
| **Git** | `gitStatus`, `gitDiff`, `gitCommit`, `gitBranch`, `gitStash`, `gitLog` |
| **Web** | `search`, `fetch`, `image`, `sourcegraph` |
| **MCP** | Any tool from connected MCP servers |

The AI is **not limited** to these — it can run anything via `shell`.

## MCP Servers

Add external tools the AI can use:

```bash
# GitHub — create issues, PRs, manage repos
/mcp add github npx @modelcontextprotocol/server-github

# File system — extended file ops
/mcp add fs npx @modelcontextprotocol/server-filesystem /home

# Memory — persistent key-value store
/mcp add memory npx @modelcontextprotocol/server-memory

# Brave Search — web search
/mcp add brave npx @modelcontextprotocol/server-brave-search
```

MCP tools are auto-discovered and registered. The AI can call them like any other tool.

## Architecture

```
bloxcode/
├── bin/cli.js              # entry point
├── src/
│   ├── index.js            # main loop, commands
│   ├── core/
│   │   ├── ansi.js         # colors
│   │   ├── context.js      # context window tracking
│   │   ├── hooks.js        # security hooks
│   │   ├── input.js        # @file refs, !shell
│   │   └── markdown.js     # terminal markdown
│   ├── config/state.js     # state, config, sessions
│   ├── providers/
│   │   ├── api.js          # LLM streaming
│   │   └── router.js       # model selection
│   ├── tools/
│   │   ├── registry.js     # dynamic tool registry
│   │   ├── files.js        # file operations
│   │   ├── shell.js        # shell, git, docker
│   │   ├── web.js          # search, fetch
│   │   └── undo.js         # undo, diff, snapshots
│   ├── agents/agent.js     # sub-agents + orchestrator
│   └── mcp/client.js       # MCP protocol client
└── package.json
```

19 files · ~3400 lines · zero dependencies · Node.js 18+

## Free Models

Works with any OpenRouter model. Best free ones:

| Model | Context | Notes |
|-------|---------|-------|
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 1M | ⭐ Default — best overall |
| `nvidia/nemotron-3-super-120b-a12b:free` | 1M | Fast fallback |
| `openai/gpt-oss-120b:free` | 131k | OpenAI open-source |
| `meta-llama/llama-3.3-70b-instruct:free` | 131k | Llama classic |
| `google/gemma-4-31b-it:free` | 262k | Multimodal |

## Update

```bash
npm install -g github:Pedrinfnf/bloxcode-ai
```

Or add this alias to always have a short command:
```bash
echo 'alias bloxupdate="npm install -g github:Pedrinfnf/bloxcode-ai"' >> ~/.bashrc
source ~/.bashrc
```

## Inspired by

- [Claude Code](https://github.com/anthropics/claude-code) — sub-agents, hooks, MCP, CLAUDE.md
- [OpenCode](https://github.com/opencode-ai/opencode) — TUI, multi-provider, sessions
- [Codex CLI](https://github.com/openai/codex) — sandbox modes, approval profiles

## License

MIT
