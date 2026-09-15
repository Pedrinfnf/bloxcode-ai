'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import BrandRail from '../components/BrandRail';
import Conversation from '../components/Conversation';
import Inspector from '../components/Inspector';

function newWorkspaceId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `workspace-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function msg(role, content) {
  return { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, role, content };
}

export default function Home() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [reasoning, setReasoning] = useState('max');
  const [status, setStatus] = useState('idle');
  const [trace, setTrace] = useState([]);
  const [files, setFiles] = useState([]);
  const [diff, setDiff] = useState('');
  const [terminalLines, setTerminalLines] = useState([]);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let id = localStorage.getItem('bloxcode-workspace-id');
    if (!id) {
      id = newWorkspaceId();
      localStorage.setItem('bloxcode-workspace-id', id);
    }
    setWorkspaceId(id);
    try {
      const saved = JSON.parse(localStorage.getItem(`bloxcode-ui-${id}`) || '[]');
      if (Array.isArray(saved)) setMessages(saved.slice(-80));
    } catch {}
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => setHealth({ ok: false, vllmConfigured: false }));
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    localStorage.setItem(`bloxcode-ui-${workspaceId}`, JSON.stringify(messages.slice(-80)));
  }, [messages, workspaceId]);

  const refreshFiles = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const response = await fetch(`/api/files?workspaceId=${encodeURIComponent(workspaceId)}`);
      const data = await response.json();
      if (response.ok) setFiles(data.files || []);
    } catch {}
  }, [workspaceId]);

  const refreshDiff = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const response = await fetch(`/api/diff?workspaceId=${encodeURIComponent(workspaceId)}`);
      const data = await response.json();
      if (response.ok) setDiff(data.diff || '');
    } catch {}
  }, [workspaceId]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !workspaceId || status !== 'idle') return;
    setInput('');
    setMessages((old) => [...old, msg('user', text)]);
    setStatus('connecting to Kimi K3…');

    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, message: text, reasoningEffort: reasoning }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Agent request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalText = '';

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === 'status') setStatus(event.message || 'working…');
          if (event.type === 'thinking') setStatus(`thinking · step ${event.step}`);
          if (event.type === 'tool_start') {
            setStatus(`running ${event.tool}…`);
            setTrace((old) => [...old.slice(-99), event]);
          }
          if (event.type === 'tool_result') setTrace((old) => [...old.slice(-99), event]);
          if (event.type === 'done') finalText = event.message?.content || 'Task finished.';
          if (event.type === 'error') throw new Error(event.message || 'Agent error');
        }
        if (done) break;
      }

      if (finalText) setMessages((old) => [...old, msg('assistant', finalText)]);
      await Promise.all([refreshFiles(), refreshDiff()]);
    } catch (error) {
      setMessages((old) => [...old, msg('assistant', `⚠ ${error.message}`)]);
      setTrace((old) => [...old.slice(-99), { type: 'error', message: error.message }]);
    } finally {
      setStatus('idle');
    }
  }, [input, workspaceId, status, reasoning, refreshFiles, refreshDiff]);

  const createWorkspace = useCallback(() => {
    const id = newWorkspaceId();
    localStorage.setItem('bloxcode-workspace-id', id);
    setWorkspaceId(id);
    setMessages([]);
    setTrace([]);
    setFiles([]);
    setDiff('');
    setTerminalLines([]);
  }, []);

  const configured = useMemo(() => health?.vllmConfigured, [health]);

  return (
    <div className="app-shell">
      <BrandRail workspaceId={workspaceId} health={health} onNewWorkspace={createWorkspace} />
      <div className="main-stage">
        {!configured && health && (
          <div className="config-banner">
            <strong>Kimi K3 model server not connected.</strong>
            <span>Set <code>VLLM_BASE_URL</code> in Vercel. Terminal, files and Git remain available.</span>
          </div>
        )}
        <div className="work-grid">
          <Conversation
            messages={messages}
            status={status}
            input={input}
            setInput={setInput}
            send={send}
            reasoning={reasoning}
            setReasoning={setReasoning}
          />
          <Inspector
            workspaceId={workspaceId}
            trace={trace}
            files={files}
            refreshFiles={refreshFiles}
            diff={diff}
            refreshDiff={refreshDiff}
            terminalLines={terminalLines}
            setTerminalLines={setTerminalLines}
          />
        </div>
      </div>
    </div>
  );
}
