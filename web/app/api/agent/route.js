import { createKimiClient } from '../../../lib/agent/kimi.mjs';
import { runAgentLoop } from '../../../lib/agent/loop.mjs';
import { createToolDefinitions, createToolExecutor } from '../../../lib/agent/tools.mjs';
import { getWorkspace } from '../../../lib/sandbox/workspace.mjs';

export const runtime = 'nodejs';
export const maxDuration = 300;

const encoder = new TextEncoder();
const SYSTEM_PROMPT = `You are BloxCode Work, an autonomous software engineering agent operating inside an isolated Linux workspace.\n\nRules:\n- Inspect the repository before making non-trivial edits.\n- Use tools instead of inventing file contents or command results.\n- Keep edits focused on the user's goal.\n- Prefer reading an existing file before overwriting it.\n- Run relevant tests/build/lint after edits when available.\n- If a tool fails, inspect the actual error and fix the cause.\n- Never claim success without verification evidence from tools.\n- The workspace is persistent across turns. Continue from its current state.\n- Your final response should briefly summarize what changed, verification performed, and any real blocker that remains.`;

function validWorkspaceId(value) { return typeof value === 'string' && value.length >= 4 && value.length <= 128; }
function validReasoning(value) { return value === 'low' || value === 'high' || value === 'max'; }
function publicEvent(event) {
  if (event.type === 'done') return { type: 'done', step: event.step, message: { role: 'assistant', content: event.message?.content || '' } };
  if (event.type === 'thinking' || event.type === 'tool_start' || event.type === 'tool_result') return event;
  if (event.type === 'status') return event;
  return { type: 'status', message: 'Working' };
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const workspaceId = body?.workspaceId;
  const reasoningEffort = validReasoning(body?.reasoningEffort) ? body.reasoningEffort : 'max';
  if (!message || message.length > 40000) return Response.json({ error: 'message must contain 1-40000 characters' }, { status: 400 });
  if (!validWorkspaceId(workspaceId)) return Response.json({ error: 'invalid workspaceId' }, { status: 400 });

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event) => { try { controller.enqueue(encoder.encode(`${JSON.stringify(publicEvent(event))}\n`)); } catch {} };
      try {
        emit({ type: 'status', message: 'Opening sandbox' });
        const workspace = await getWorkspace(workspaceId);
        const tools = createToolDefinitions();
        const history = await workspace.loadSession();
        const messages = history.length > 0 ? [...history, { role: 'user', content: message }] : [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: message }];
        const client = createKimiClient({ baseUrl: process.env.VLLM_BASE_URL, apiKey: process.env.VLLM_API_KEY || '', model: process.env.KIMI_MODEL || 'moonshotai/Kimi-K3', reasoningEffort, tools });
        const result = await runAgentLoop({ messages, client, tools, executeTool: createToolExecutor(workspace), maxSteps: Math.min(Math.max(Number(process.env.MAX_AGENT_STEPS) || 12, 1), 32), onEvent: emit });
        await workspace.saveSession(result.history);
      } catch (error) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) })}\n`));
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-content-type-options': 'nosniff' } });
}
