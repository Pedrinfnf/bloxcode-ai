const VALID_REASONING = new Set(['low', 'high', 'max']);

export function normalizeVllmBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

export function buildKimiRequest({ messages, tools, reasoningEffort = 'max', model = 'moonshotai/Kimi-K3' }) {
  if (!Array.isArray(messages)) throw new TypeError('messages must be an array');
  if (!Array.isArray(tools)) throw new TypeError('tools must be an array');
  if (!VALID_REASONING.has(reasoningEffort)) throw new TypeError('invalid reasoning effort');
  return {
    model,
    messages,
    tools,
    tool_choice: 'auto',
    reasoning_effort: reasoningEffort,
    stream: false,
  };
}

export function createKimiClient({ baseUrl, apiKey = '', model = 'moonshotai/Kimi-K3', reasoningEffort = 'max', tools = [], fetchImpl = fetch }) {
  const normalized = normalizeVllmBaseUrl(baseUrl);
  if (!normalized) {
    throw new Error('VLLM_BASE_URL is not configured');
  }

  return async function kimiClient(messages) {
    const headers = { 'content-type': 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    const response = await fetchImpl(`${normalized}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildKimiRequest({ messages, tools, reasoningEffort, model })),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`vLLM request failed (${response.status}): ${text.slice(0, 1200)}`);
    }

    const data = await response.json();
    const message = data?.choices?.[0]?.message;
    if (!message || message.role !== 'assistant') {
      throw new Error('vLLM returned no assistant message');
    }
    return message;
  };
}
