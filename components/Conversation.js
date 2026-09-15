'use client';

import { useEffect, useRef } from 'react';

function Message({ message }) {
  return (
    <article className={`message ${message.role}`}>
      <div className="message-avatar">{message.role === 'user' ? 'P' : 'K3'}</div>
      <div className="message-body">
        <div className="message-meta">{message.role === 'user' ? 'You' : 'BloxCode Work'}</div>
        <div className="message-text">{message.content}</div>
      </div>
    </article>
  );
}

export default function Conversation({ messages, status, input, setInput, send, reasoning, setReasoning }) {
  const endRef = useRef(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [messages, status]);

  const submit = (event) => { event.preventDefault(); send(); };

  return (
    <main className="conversation-pane">
      <header className="work-header">
        <div><div className="eyebrow">Agent workspace</div><h1>Kimi K3 <span>via vLLM</span></h1></div>
        <div className="reasoning-picker" title="Kimi K3 reasoning effort">
          {['low', 'high', 'max'].map((value) => (
            <button key={value} onClick={() => setReasoning(value)} className={reasoning === value ? 'active' : ''}>{value}</button>
          ))}
        </div>
      </header>
      <section className="messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-orb">⌁</div>
            <h2>Give me a real programming task.</h2>
            <p>I can inspect files, run commands, edit code, test changes and show you the diff in one persistent Linux workspace.</p>
            <div className="prompt-grid">
              <button onClick={() => setInput('Inspect this repository and explain its architecture before changing anything.')}>Inspect a repo</button>
              <button onClick={() => setInput('Find the failing tests, diagnose the root cause, fix them, and verify the full test suite.')}>Fix failing tests</button>
              <button onClick={() => setInput('Build the requested feature, run the relevant tests, and show me the final diff.')}>Build a feature</button>
            </div>
          </div>
        )}
        {messages.map((message) => <Message key={message.id} message={message} />)}
        {status !== 'idle' && <div className="working-row"><span className="pulse" /><span>{status}</span></div>}
        <div ref={endRef} />
      </section>
      <form className="composer-wrap" onSubmit={submit}>
        <div className="composer">
          <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Ask BloxCode to build, debug, test, refactor..." rows={2} />
          <div className="composer-footer">
            <span>Persistent sandbox · Kimi K3 · {reasoning} reasoning</span>
            <button className="send-button" type="submit" disabled={!input.trim() || status !== 'idle'}>↑</button>
          </div>
        </div>
      </form>
    </main>
  );
}
