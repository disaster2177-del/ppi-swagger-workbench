import { useRef, useState } from 'react';
import { Badge, Button, ConfirmDialog, EmptyState, Icon, MethodBadge, StatusCode, formatBytes, timeAgo } from '../../ui/index.jsx';
import { ProjectForm } from './ProjectDialogs.jsx';

/** Left sidebar: projects as entities, with counts and quick switching. */
export function ProjectsPanel({ wb }) {
  return (
    <div className="side-panel">
      <section>
        <h3 className="eyebrow">Projects</h3>
        {wb.projectsStatus === 'loading' && !wb.projects.length ? (
          <p className="muted">Loading…</p>
        ) : !wb.projects.length ? (
          <p className="muted">No projects yet. Create one below.</p>
        ) : (
          <ul className="side-list">
            {wb.projects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`side-item${p.id === wb.projectId ? ' selected' : ''}`}
                  aria-current={p.id === wb.projectId ? 'true' : undefined}
                  onClick={() => wb.selectProject(p.id)}
                >
                  <Icon name="folder" />
                  <span className="side-item-main">
                    <span className="side-item-title">{p.name}</span>
                    <span className="side-item-meta tabular">
                      {p.yamlCount} YAML · {p.endpointCount} APIs
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <details className="disclosure side-new">
        <summary>New project</summary>
        <ProjectForm submitLabel="Create project" onSubmit={(d) => wb.createProject(d)} />
      </details>
      {wb.source && <StoragePanel wb={wb} />}
    </div>
  );
}

// Pages hosted inside Claude cannot start file downloads, so Export is hidden there.
const HOSTED_PREVIEW = typeof window !== 'undefined' && typeof window.claude?.use === 'function';

/** Where this browser's workspace lives, how full it is, and backup / restore. */
export function StoragePanel({ wb }) {
  const fileRef = useRef(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const s = wb.source;
  const used = s.storage.usageBytes();
  const pct = Math.min(100, Math.round((used / s.storage.quotaBytes) * 100));
  return (
    <section className="side-note">
      <h3 className="eyebrow">Storage</h3>
      <p>
        <Badge tone={s.persistent ? 'good' : 'warn'}>
          <Icon name="shield" size={11} /> {s.label}
        </Badge>
      </p>
      <p className="muted">{s.note}</p>
      {s.persistent && (
        <>
          <div className={`storage-meter${pct > 80 ? ' warn' : ''}`} role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Browser storage used">
            <span style={{ width: `${Math.max(pct, 1)}%` }} />
          </div>
          <p className="muted tabular">
            {formatBytes(used)} used of about {formatBytes(s.storage.quotaBytes)}
          </p>
          <div className="storage-actions">
            {!HOSTED_PREVIEW && (
              <Button size="sm" icon="upload" onClick={wb.exportWorkspace} disabled={!wb.projects.length}>
                Export
              </Button>
            )}
            <Button size="sm" icon="file" onClick={() => fileRef.current?.click()}>
              Import
            </Button>
            <Button size="sm" variant="ghost" icon="trash" onClick={() => setConfirmClear(true)} disabled={!wb.projects.length}>
              Clear
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) wb.importWorkspace(f);
              e.target.value = '';
            }}
          />
        </>
      )}
      <ConfirmDialog
        open={confirmClear}
        title="Clear this browser's workspace?"
        danger
        confirmLabel="Clear workspace"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          wb.clearWorkspace();
        }}
      >
        All projects and YAML files saved in this browser will be deleted. Other PCs and browsers are not affected. Export first if you want a copy.
      </ConfirmDialog>
    </section>
  );
}

/** Right sidebar: what happened this session (API calls, last upload). */
export function ActivityPanel({ wb }) {
  return (
    <div className="side-panel">
      {wb.uploadReportLast && (
        <section>
          <h3 className="eyebrow">Last upload</h3>
          <p>
            {wb.uploadReportLast.succeeded} stored, {wb.uploadReportLast.failed} rejected
          </p>
        </section>
      )}
      <section>
        <h3 className="eyebrow">API requests this session</h3>
        {!wb.history.length ? (
          <EmptyState icon="activity" title="No requests yet">
            Executed API requests appear here.
          </EmptyState>
        ) : (
          <ul className="history-list">
            {wb.history.map((h) => {
              const canOpen = h.yamlFileId === wb.yamlFileId;
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    className="history-item"
                    disabled={!canOpen}
                    title={canOpen ? 'Open this API' : `From ${h.fileName}. Open that YAML file to return to it.`}
                    onClick={() => canOpen && wb.selectEndpoint(h.endpointKey)}
                  >
                    <MethodBadge method={h.method} />
                    <span className="history-main">
                      <span className="history-path">{h.path}</span>
                      <span className="side-item-meta">
                        {h.fileName} · {timeAgo(h.at)}
                        {h.durationMs !== undefined ? ` · ${h.durationMs} ms` : ''}
                      </span>
                      {h.error && <span className="text-bad side-item-meta">{h.error}</span>}
                    </span>
                    <StatusCode status={h.status} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {wb.history.length > 0 && (
          <Button size="sm" variant="ghost" onClick={wb.clearHistory}>
            Clear list
          </Button>
        )}
      </section>
    </div>
  );
}
