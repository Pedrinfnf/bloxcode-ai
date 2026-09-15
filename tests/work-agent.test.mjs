import test from 'node:test';
import assert from 'node:assert/strict';

import { buildKimiRequest, normalizeVllmBaseUrl } from '../lib/agent/kimi.mjs';
import { runAgentLoop } from '../lib/agent/loop.mjs';
import {
  safeWorkspacePath,
  assertCommandAllowed,
  normalizeWorkspaceName,
} from '../lib/agent/policy.mjs';
import { createToolDefinitions, createToolExecutor } from '../lib/agent/tools.mjs';

const tools = [
  {
    type: 'function',
    function: {
      name: 'shell',
      description: 'Run a command',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
];

test('normalizes vLLM base URL without duplicating /v1', () => {
  assert.equal(normalizeVllmBaseUrl('https://gpu.example.com/'), 'https://gpu.example.com');
  assert.equal(normalizeVllmBaseUrl('https://gpu.example.com/v1'), 'https://gpu.example.com');
});

test('builds Kimi K3 request with tool calling and reasoning effort', () => {
  const messages = [{ role: 'user', content: 'fix it' }];
  const body = buildKimiRequest({ messages, tools, reasoningEffort: 'high', model: 'moonshotai/Kimi-K3' });
  assert.equal(body.model, 'moonshotai/Kimi-K3');
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(body.tool_choice, 'auto');
  assert.deepEqual(body.messages, messages);
  assert.deepEqual(body.tools, tools);
});

test('agent loop preserves the complete Kimi assistant message before tool results', async () => {
  const assistantWithTool = {
    role: 'assistant',
    content: '',
    reasoning_content: 'I need to inspect the repository first.',
    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'shell', arguments: '{"command":"pwd"}' } }],
  };
  const assistantFinal = { role: 'assistant', content: 'Done.', reasoning_content: 'The tool result is enough.' };
  const calls = [];
  const client = async (messages) => {
    calls.push(structuredClone(messages));
    return calls.length === 1 ? assistantWithTool : assistantFinal;
  };
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'where am I?' }],
    client,
    tools,
    maxSteps: 4,
    executeTool: async (name, args) => {
      assert.equal(name, 'shell');
      assert.deepEqual(args, { command: 'pwd' });
      return { ok: true, stdout: '/home/vercel-sandbox/workspace\n' };
    },
  });
  assert.equal(result.message.content, 'Done.');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1][1], assistantWithTool);
  assert.equal(calls[1][2].role, 'tool');
  assert.equal(calls[1][2].tool_call_id, 'call_1');
  assert.match(calls[1][2].content, /workspace/);
});

test('agent loop emits tool lifecycle events', async () => {
  const events = [];
  let n = 0;
  const client = async () => {
    n += 1;
    if (n === 1) {
      return { role: 'assistant', content: '', reasoning_content: 'run a check', tool_calls: [{ id: 'c', type: 'function', function: { name: 'shell', arguments: '{"command":"echo ok"}' } }] };
    }
    return { role: 'assistant', content: 'all good', reasoning_content: 'finished' };
  };
  await runAgentLoop({
    messages: [{ role: 'user', content: 'check' }],
    client,
    tools,
    maxSteps: 3,
    executeTool: async () => ({ ok: true, stdout: 'ok\n' }),
    onEvent: (event) => events.push(event),
  });
  assert.deepEqual(events.map((e) => e.type), ['thinking', 'tool_start', 'tool_result', 'thinking', 'done']);
});

test('safeWorkspacePath keeps paths inside workspace root', () => {
  assert.equal(safeWorkspacePath('src/app.js'), '/home/vercel-sandbox/workspace/src/app.js');
  assert.equal(safeWorkspacePath('./README.md'), '/home/vercel-sandbox/workspace/README.md');
  assert.throws(() => safeWorkspacePath('../secret'), /outside workspace/i);
  assert.throws(() => safeWorkspacePath('/etc/passwd'), /absolute paths/i);
  assert.throws(() => safeWorkspacePath('a\0b'), /nul/i);
});

test('command policy rejects obviously destructive commands', () => {
  assert.doesNotThrow(() => assertCommandAllowed('npm test'));
  assert.doesNotThrow(() => assertCommandAllowed('git diff'));
  assert.throws(() => assertCommandAllowed('rm -rf /'), /blocked/i);
  assert.throws(() => assertCommandAllowed('sudo reboot'), /blocked/i);
  assert.throws(() => assertCommandAllowed('mkfs.ext4 /dev/sda'), /blocked/i);
});

test('workspace names are stable, short, and safe', () => {
  assert.equal(normalizeWorkspaceName('ABC-123_xyz'), 'bloxcode-abc-123-xyz');
  assert.match(normalizeWorkspaceName('   !!!   '), /^bloxcode-[a-f0-9]{12}$/);
  assert.ok(normalizeWorkspaceName('x'.repeat(500)).length <= 63);
});

test('tool definitions expose only the bounded workspace tools', () => {
  const defs = createToolDefinitions();
  assert.deepEqual(defs.map((tool) => tool.function.name), ['shell', 'list_files', 'read_file', 'write_file', 'git_diff']);
});

test('tool executor validates arguments and delegates to workspace methods', async () => {
  const calls = [];
  const workspace = {
    run: async (command) => { calls.push(['run', command]); return { ok: true, stdout: 'ok' }; },
    listFiles: async (path) => { calls.push(['list', path]); return ['a.js']; },
    readFile: async (path) => { calls.push(['read', path]); return 'hello'; },
    writeFile: async (path, content) => { calls.push(['write', path, content]); return { ok: true }; },
    gitDiff: async () => { calls.push(['diff']); return 'diff --git'; },
  };
  const execute = createToolExecutor(workspace);
  assert.deepEqual(await execute('shell', { command: 'echo ok' }), { ok: true, stdout: 'ok' });
  assert.deepEqual(await execute('list_files', { path: 'src' }), ['a.js']);
  assert.equal(await execute('read_file', { path: 'README.md' }), 'hello');
  assert.deepEqual(await execute('write_file', { path: 'x.txt', content: 'x' }), { ok: true });
  assert.equal(await execute('git_diff', {}), 'diff --git');
  await assert.rejects(() => execute('shell', {}), /command/i);
  await assert.rejects(() => execute('unknown', {}), /unknown tool/i);
  assert.deepEqual(calls, [['run', 'echo ok'], ['list', 'src'], ['read', 'README.md'], ['write', 'x.txt', 'x'], ['diff']]);
});
