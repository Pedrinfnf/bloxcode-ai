# BloxCode v4.1 — Changelog & Roadmap de Melhorias

## ✅ O que foi feito nesta atualização (v4.0 → v4.1)

### 🔑 Sistema de API Key Runtime (`/api`)
- **`/api set <key>`** — configura a key interativamente ou inline
- **`/api show`** — mostra key mascarada (sk-or-xxx...xxxx)
- **`/api url <url>`** — muda base URL (suporta Ollama, LiteLLM, qualquer OpenAI-compat)
- **`/api status`** — tabela com key, URL, fonte (env/config)
- Key salva em **`~/.bloxcode/config.json`** (global, não no projeto)
- Resolução por prioridade: `ENV var > ~/.bloxcode/config.json`
- **Nunca mais precisa exportar env var!** Configura 1x e pronto

### 💾 Multi-Sessão (`/session`)
- **`/session save [nome]`** — salva conversa atual
- **`/session list`** — lista sessões salvas
- **`/session load`** — seletor interativo ↑↓ para carregar
- **`/session new`** — inicia sessão limpa
- Sessões salvas em `.bloxcode/sessions/`

### 🔒 Segurança
- API key nunca salva no projeto (só em `~/.bloxcode/`)
- Banner mostra status da key (✅/❌)
- Prompt mostra 🔑/⚠️ se key configurada ou não
- Chat bloqueado se não tiver key (com instruções claras)

### 🛠️ Melhorias de Código
- `API_KEY` const removida → agora usa `getApiKey()` (dinâmico)
- `api.js` usa `state.apiBaseUrl` em vez de URL hardcoded
- `router.js` usa `getApiKey()` para benchmark
- Mais preços de modelos na tabela de custos
- Diretório `~/.bloxcode/` criado automaticamente

---

## 🗺️ ROADMAP — O que ainda dá pra melhorar

### 🔴 PRIORIDADE ALTA (impacto grande)

1. **Tool-use nativo (OpenAI function calling)**
   - Hoje: o LLM responde JSON manual (`{"type":"tool",...}`)
   - Ideal: usar `tools[]` do OpenAI API para tool calling nativo
   - O LLM entende melhor, erra menos, e o streaming de tool calls é built-in
   - Isso sozinho melhora 10x a confiabilidade

2. **Loop de tool-call multi-step automático**
   - Hoje: o agente faz 1 tool call por vez, volta pro loop
   - Ideal: loop interno que continua chamando tools até o LLM dar `final`
   - Como Claude Code faz: read → edit → test → commit tudo em 1 prompt

3. **Markdown rendering no terminal**
   - Hoje: output cru do LLM
   - Ideal: renderizar markdown com cores (cabeçalhos, código, listas)
   - Pacote: usar `marked-terminal` ou implementar parser simples

4. **Context window tracking real**
   - Hoje: compacta por chars (~120k chars ≈ 30k tokens)
   - Ideal: contar tokens reais por modelo (tiktoken ou estimativa 4char/tok)
   - Mostrar barra de uso: `[████████░░░░] 65% de 128k`

### 🟡 PRIORIDADE MÉDIA

5. **Undo/Redo stack**
   - Backups existem mas `/undo` não funciona no v4
   - Implementar stack de desfazer com diff preview

6. **File watcher (auto-reindex)**
   - Hoje: precisa `/reindex` manual
   - Ideal: usar `fs.watch()` para reindexar quando arquivos mudam

7. **Snapshot system**
   - `/snapshot save|list|load` existia no v3.4 mas não migrou pro v4
   - Snapshot = zip do workspace inteiro para rollback

8. **Scaffold/Templates**
   - `/scaffold react|node|python` para criar projetos
   - Existia no v3.4, não migrou

9. **Streaming interrompível**
   - Ctrl+C durante streaming deveria cancelar a resposta (não sair)
   - Hoje Ctrl+C é interceptado mas não cancela o stream

10. **Cost tracking por sessão persistido**
    - Salvar stats em `.bloxcode/stats.json` ao sair
    - `/stats total` — custo acumulado de todas as sessões

### 🟢 PRIORIDADE BAIXA (nice-to-have)

11. **Syntax highlighting no cat/diff**
    - Pintar código com cores por linguagem
    - Pelo menos keywords + strings + comments

12. **Tab-completion para paths**
    - Quando digitar `@src/` no chat, completar com arquivos reais
    - Como Pi e OpenCode fazem

13. **Keybindings customizáveis**
    - Ctrl+L = limpar tela
    - Ctrl+R = buscar no histórico
    - Ctrl+K = compactar

14. **Themes**
    - OpenCode tem 10+ temas (dracula, gruvbox, catppuccin...)
    - `/theme <name>` para mudar cores

15. **Parallel sub-agents**
    - Hoje: agentes rodam sequencialmente
    - Ideal: rodar Coder + Reviewer em paralelo quando independentes

16. **Plugin system**
    - `/plugin install <nome>` para adicionar tools/agentes
    - Carregar `.bloxcode/plugins/*.js` automaticamente

17. **Image display no terminal**
    - Kitty/iTerm2 protocol para mostrar imagens inline
    - Fallback: ASCII art ou link

18. **LSP integration**
    - OpenCode tem LSP client completo
    - Diagnostics (erros do TypeScript/ESLint) como contexto pro LLM

19. **Custom providers**
    - `/api provider anthropic` — usar API da Anthropic direto
    - `/api provider ollama` — modelos locais
    - Hoje já funciona com `/api url` mas sem auth diferente

20. **Web UI companion**
    - Servir interface web em localhost para visualizar
    - Como OpenCode faz com BubbleTea (mas em HTML)
