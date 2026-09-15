# BloxCode Work — Kimi K3 Web Agent Design

## Goal

Build a browser-first agentic programming workspace inside `Pedrinfnf/bloxcode-ai`. It must keep the existing CLI intact while adding a Vercel-hosted web experience with chat, agent traces, a real isolated terminal, files, and Git diff. The model backend is self-hosted Kimi K3 exposed by vLLM's OpenAI-compatible `/v1/chat/completions` endpoint.

## Scope for v0.1

- Standalone Next.js App Router web app under `web/`; the root CLI package remains byte-for-byte unchanged.
- Kimi K3 model client using `VLLM_BASE_URL`, optional `VLLM_API_KEY`, and `KIMI_MODEL`.
- Agent loop that supports tool calling and preserves the complete Kimi assistant message, including `reasoning_content` and `tool_calls`, between turns.
- Persistent Vercel Sandbox workspace per browser workspace ID.
- Agent tools: `shell`, `list_files`, `read_file`, `write_file`, `git_diff`.
- Manual terminal route using the same sandbox.
- File browser route and Git diff route.
- Work-like UI with conversation, task timeline/tool trace, terminal, files, and diff.
- Node built-in unit tests for model request formation, tool-loop history preservation, path safety, and command policy.
- Existing `bin/` and `src/` CLI files remain untouched.

## Non-goals for v0.1

- Hosting Kimi K3 weights on Vercel. vLLM runs on a separate GPU host and Vercel connects to it via `VLLM_BASE_URL`.
- Billing, multi-user authentication, database persistence, MCP, browser automation, or multi-agent delegation.
- Production-scale queueing. One request executes one bounded agent loop with a strict step cap.

## Architecture

Browser -> Next.js route handlers -> Agent loop -> vLLM/Kimi K3. Tool calls are executed against a persistent Vercel Sandbox named from the workspace ID. The same named sandbox is reused by chat, terminal, file browser, and diff routes, so state survives between requests.

The web application never executes AI-generated commands on the Vercel function host. Shell commands run only inside Vercel Sandbox. File paths are normalized under `/home/vercel-sandbox/workspace`; traversal outside that root is rejected before execution.

## Model protocol

The model client sends requests to `${VLLM_BASE_URL}/v1/chat/completions` with:

- `model`: `KIMI_MODEL`, default `moonshotai/Kimi-K3`
- `messages`: complete conversation including prior assistant `reasoning_content` and `tool_calls`
- `tools`: OpenAI-compatible function schemas
- `tool_choice: "auto"`
- `reasoning_effort`: `low`, `high`, or `max`

When Kimi returns tool calls, the entire assistant message is appended unchanged to history before tool-result messages are appended. The loop stops when Kimi returns no tool calls or after `MAX_AGENT_STEPS` (default 12).

## Sandbox

Use `@vercel/sandbox` persistent named sandboxes via `Sandbox.getOrCreate({ name })`. Sandbox names are derived from a validated workspace ID. Filesystem access uses `/home/vercel-sandbox/workspace` as the only allowed root.

A new sandbox initializes the workspace directory and Git if needed. Network access remains the Vercel Sandbox default for v0.1; stricter network policies are a later hardening step.

## Security

- Reject workspace file traversal (`..`, absolute paths outside workspace root, NUL bytes).
- Reject a small set of obviously destructive commands even inside the sandbox (`rm -rf /`, `mkfs`, reboot/shutdown, raw block-device overwrite, fork bomb signatures).
- Cap agent tool iterations.
- Cap terminal command length and model message count.
- Never expose `VLLM_API_KEY` to the browser.
- Never execute shell on the Vercel function host.

## UI

Desktop uses three visual regions: compact left rail, central agent conversation, right workspace inspector. The inspector has Terminal, Files, Diff, and Trace tabs. Mobile collapses to one primary surface with bottom tabs. The design uses a dark neutral base, cyan/teal accents, monospace for execution output, and status chips for `thinking`, `tool`, `success`, and `error` states.

## Verification

- `cd web && node --test tests/*.test.mjs`
- syntax checks for all `web/**/*.mjs` server modules with `node --check`
- Vercel remote build must succeed after GitHub checkpoint
- deployed `/api/health` and root page must respond successfully
- live Kimi generation is considered configured only when a reachable `VLLM_BASE_URL` exists; deployment without that endpoint remains usable for terminal/files/diff but chat reports an explicit configuration error.
