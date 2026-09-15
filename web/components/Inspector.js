'use client';

import { useMemo, useState } from 'react';

const TABS = ['terminal', 'files', 'diff', 'trace'];

function Terminal({ workspaceId, lines, setLines }) {
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const value = command.trim();
    if (!value || busy) return;
    setBusy(true); setCommand(''); setLines((old) => [...old, { type: 'command', text: `$ ${value}` }]);
    try {
      const response = await fetch('/api/terminal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId, command: value }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'terminal request failed');
      if (data.stdout) setLines((old) => [...old, { type: 'stdout', text: data.stdout }]);
      if (data.stderr) setLines((old) => [...old, { type: 'stderr', text: data.stderr }]);
      if (!data.stdout && !data.stderr) setLines((old) => [...old, { type: 'muted', text: `[exit ${data.exitCode ?? 0}]` }]);
    } catch (error) { setLines((old) => [...old, { type: 'stderr', text: error.message }]); }
    finally { setBusy(false); }
  };
  return <div className="terminal-shell"><div className="terminal-output"><div className="terminal-welcome">BloxCode sandbox · /home/vercel-sandbox/workspace</div>{lines.map((line, index) => <pre key={index} className={line.type}>{line.text}</pre>)}</div><div className="terminal-input-row"><span>$</span><input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && run()} placeholder={busy ? 'running…' : 'command'} disabled={busy}/><button onClick={run} disabled={busy || !command.trim()}>Run</button></div></div>;
}

function Files({ workspaceId, files, refreshFiles }) {
  const [selected, setSelected] = useState(null); const [content, setContent] = useState(''); const [loading, setLoading] = useState(false);
  const openFile = async (file) => {
    if (file.type !== 'file') return;
    setSelected(file.path); setLoading(true);
    try { const response = await fetch(`/api/files?workspaceId=${encodeURIComponent(workspaceId)}&file=${encodeURIComponent(file.path)}`); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'read failed'); setContent(data.content); }
    catch (error) { setContent(`Error: ${error.message}`); } finally { setLoading(false); }
  };
  return <div className="files-view"><div className="panel-toolbar"><span>{files.length} entries</span><button onClick={refreshFiles}>Refresh</button></div><div className="file-list">{files.length === 0 && <div className="panel-empty">Workspace is empty. Clone or create a project from chat/terminal.</div>}{files.map((file) => <button key={`${file.type}:${file.path}`} onClick={() => openFile(file)} className={selected === file.path ? 'selected' : ''}><span>{file.type === 'directory' ? '▸' : '·'}</span><span>{file.path}</span></button>)}</div>{selected && <div className="file-preview"><div className="file-preview-title">{selected}</div><pre>{loading ? 'Loading…' : content}</pre></div>}</div>;
}

function Diff({ diff, refreshDiff }) { return <div className="diff-view"><div className="panel-toolbar"><span>Working tree</span><button onClick={refreshDiff}>Refresh</button></div><pre>{diff || 'No Git changes yet.'}</pre></div>; }

function Trace({ events }) {
  return <div className="trace-view">{events.length === 0 && <div className="panel-empty">Tool calls and verification steps will appear here.</div>}{events.map((event, index) => <div className={`trace-event ${event.type}`} key={`${event.type}-${index}`}><div className="trace-icon">{event.type === 'tool_start' ? '↳' : event.type === 'tool_result' ? '✓' : event.type === 'error' ? '!' : '·'}</div><div><strong>{event.tool || event.type.replace('_', ' ')}</strong>{event.type === 'tool_start' && <code>{JSON.stringify(event.args)}</code>}{event.type === 'tool_result' && <code>{JSON.stringify(event.result).slice(0, 800)}</code>}{event.message && <span>{event.message}</span>}</div></div>)}</div>;
}

export default function Inspector({ workspaceId, trace, files, refreshFiles, diff, refreshDiff, terminalLines, setTerminalLines }) {
  const [tab, setTab] = useState('terminal');
  const title = useMemo(() => workspaceId ? workspaceId.slice(0, 18) : 'workspace', [workspaceId]);
  return <aside className="inspector"><div className="inspector-head"><div><span className="live-dot" />{title}</div><span className="sandbox-badge">sandbox</span></div><div className="inspector-tabs">{TABS.map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div><div className="inspector-body">{tab === 'terminal' && <Terminal workspaceId={workspaceId} lines={terminalLines} setLines={setTerminalLines} />}{tab === 'files' && <Files workspaceId={workspaceId} files={files} refreshFiles={refreshFiles} />}{tab === 'diff' && <Diff diff={diff} refreshDiff={refreshDiff} />}{tab === 'trace' && <Trace events={trace} />}</div></aside>;
}
