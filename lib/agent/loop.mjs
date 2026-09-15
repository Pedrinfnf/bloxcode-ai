function parseArguments(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {}
  throw new Error('Tool arguments are not valid JSON');
}

function serializeToolResult(result) {
  if (typeof result === 'string') return result;
  return JSON.stringify(result ?? null);
}

export async function runAgentLoop({ messages, client, tools, executeTool, maxSteps = 12, onEvent = () => {} }) {
  if (!Array.isArray(messages) || messages.length === 0) throw new TypeError('messages are required');
  if (typeof client !== 'function') throw new TypeError('client is required');
  if (typeof executeTool !== 'function') throw new TypeError('executeTool is required');

  const history = structuredClone(messages);
  const trace = [];

  for (let step = 1; step <= maxSteps; step += 1) {
    onEvent({ type: 'thinking', step });
    const assistant = await client(history, tools);
    history.push(structuredClone(assistant));

    const toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
    if (toolCalls.length === 0) {
      const event = { type: 'done', step, message: assistant };
      trace.push(event);
      onEvent(event);
      return { message: assistant, history, trace, steps: step };
    }

    for (const call of toolCalls) {
      const name = call?.function?.name;
      if (!name) throw new Error('Tool call missing function name');
      const args = parseArguments(call.function.arguments);
      const start = { type: 'tool_start', step, tool: name, args, toolCallId: call.id };
      trace.push(start);
      onEvent(start);

      let result;
      try {
        result = await executeTool(name, args, call);
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }

      const resultEvent = { type: 'tool_result', step, tool: name, result, toolCallId: call.id };
      trace.push(resultEvent);
      onEvent(resultEvent);
      history.push({
        role: 'tool',
        tool_call_id: call.id,
        content: serializeToolResult(result),
      });
    }
  }

  throw new Error(`Agent exceeded maximum of ${maxSteps} steps`);
}
