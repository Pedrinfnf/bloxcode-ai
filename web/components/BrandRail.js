'use client';

export default function BrandRail({ workspaceId, health, onNewWorkspace }) {
  return (
    <aside className="brand-rail">
      <div className="brand-mark">B</div>
      <div className="brand-copy">
        <strong>BloxCode</strong>
        <span>Work</span>
      </div>
      <div className="rail-divider" />
      <button className="new-workspace" onClick={onNewWorkspace} title="New workspace">
        <span>＋</span><span>New</span>
      </button>
      <div className="rail-spacer" />
      <div className={`model-dot ${health?.vllmConfigured ? 'online' : 'offline'}`} />
      <div className="rail-meta" title={workspaceId}>
        <span>K3</span><small>{health?.vllmConfigured ? 'online' : 'setup'}</small>
      </div>
    </aside>
  );
}
