import { Badge, Button, EmptyState, Icon, MethodBadge, StatusCode, timeAgo } from '../../ui/index.jsx';
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
      {wb.source && (
        <section className="side-note">
          <h3 className="eyebrow">Storage</h3>
          <p>
            <Badge tone={wb.source.kind === 'memory' ? 'warn' : 'good'}>{wb.source.label}</Badge>
          </p>
          {wb.source.note && <p className="muted">{wb.source.note}</p>}
        </section>
      )}
    </div>
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
