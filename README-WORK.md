# BloxCode Work — Kimi K3 Web Agent

BloxCode Work adds a browser-first coding agent to the existing BloxCode CLI without replacing the CLI.

## What the web app does

- Kimi K3 through your own vLLM server
- persistent Vercel Sandbox per workspace
- autonomous tool loop (`shell`, files, Git diff)
- real terminal in the browser
- file browser and source preview
- Git working-tree diff
- visible tool execution trace
- low / high / max Kimi reasoning selector

## Model server

Run Kimi K3 on the GPU host:

```bash
pip install vllm
vllm serve "moonshotai/Kimi-K3"
```

Point the Vercel project at that server:

```env
VLLM_BASE_URL=https://your-vllm-host.example.com
KIMI_MODEL=moonshotai/Kimi-K3
MAX_AGENT_STEPS=12
```

`VLLM_API_KEY` is optional and is only for protecting your own vLLM endpoint. No OpenAI API key is required.

Kimi K3 returns `reasoning_content` and tool calls. The server stores its complete raw model history inside the persistent sandbox, while the browser only receives final assistant text plus tool lifecycle events.

## Web development

```bash
npm install
npm run dev:web
```

## Tests

```bash
npm test
npm run build
```

## Security model

AI-generated shell commands execute only inside Vercel Sandbox. Workspace file tools reject path traversal and never access files outside `/home/vercel-sandbox/workspace`. A small denylist blocks catastrophic commands such as filesystem formatting, host shutdown/reboot and `rm -rf /` even inside the sandbox.

## Existing CLI

The current BloxCode terminal agent remains available:

```bash
npm start
```
