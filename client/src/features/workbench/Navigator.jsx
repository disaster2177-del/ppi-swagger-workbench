/**
 * Left column of the workbench: the selected project's YAML files, then the
 * APIs of the selected file, both searchable.
 */
import { useMemo, useState } from 'react';
import { Badge, ConfirmDialog, EmptyState, Icon, IconButton, MethodBadge, SearchInput, timeAgo, formatDateTime, formatBytes } from '../../ui/index.jsx';

const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE'];

export function YamlFileList({ wb, onDropFiles }) {
  const [q, setQ] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const files = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? wb.yamlFiles.filter((f) => [f.fileName, f.title, f.apiVersion].some((v) => String(v ?? '').toLowerCase().includes(n))) : wb.yamlFiles;
  }, [wb.yamlFiles, q]);

  const dropProps = wb.projectId
    ? {
        onDragOver: (e) => {
          if ([...(e.dataTransfer?.types ?? [])].includes('Files')) {
            e.preventDefault();
            setDragging(true);
          }
        },
        onDragLeave: () => setDragging(false),
        onDrop: (e) => {
          e.preventDefault();
          setDragging(false);
          onDropFiles(e.dataTransfer.files);
        },
      }
    : {};

  return (
    <section className={`nav-section${dragging ? ' dragging' : ''}`} aria-label="YAML files" {...dropProps}>
      <div className="nav-section-head">
        <h3 className="eyebrow">
          YAML files <span className="tabular">{wb.yamlFiles.length || ''}</span>
        </h3>
        {wb.yamlStatus === 'loading' && <span className="spinner" aria-label="Loading" />}
      </div>
      {wb.yamlFiles.length > 4 && <SearchInput value={q} onChange={setQ} placeholder="Search YAML files…" />}
      {!wb.projectId ? (
        <p className="nav-empty">Select a project to see its YAML files.</p>
      ) : wb.yamlStatus === 'ready' && !wb.yamlFiles.length ? (
        <p className="nav-empty">
          No YAML files in this project yet. Use <strong>Upload YAML</strong> or drop files here.
        </p>
      ) : files.length === 0 && q ? (
        <p className="nav-empty">No YAML file matches “{q}”.</p>
      ) : (
        <ul className="file-list" role="listbox" aria-label="YAML files">
          {files.map((f) => (
            <li key={f.id}>
              <div
                role="option"
                aria-selected={f.id === wb.yamlFileId}
                tabIndex={0}
                className={`file-item${f.id === wb.yamlFileId ? ' selected' : ''}`}
                onClick={() => wb.selectYaml(f.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), wb.selectYaml(f.id))}
                title={`${f.filePath}\nCreated ${formatDateTime(f.createdAt)}\nUpdated ${formatDateTime(f.updatedAt)}`}
              >
                <Icon name="file" />
                <div className="file-main">
                  <div className="file-name">{f.fileName}</div>
                  <div className="file-meta">
                    {f.title ? `${f.title}${f.apiVersion ? ` · v${f.apiVersion}` : ''} · ` : ''}
                    <span className="tabular">{f.endpointCount} APIs</span> · {formatBytes(f.sizeBytes)} · {timeAgo(f.updatedAt)}
                  </div>
                </div>
                <IconButton
                  icon="trash"
                  size="sm"
                  label={`Delete ${f.fileName}`}
                  className="file-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDelete(f);
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {dragging && <div className="drop-hint">Drop YAML files to upload</div>}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete YAML file?"
        danger
        busy={busy}
        confirmLabel="Delete file"
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await wb.deleteYaml(pendingDelete.id);
          } catch (err) {
            wb.onError?.(err);
          } finally {
            setBusy(false);
            setPendingDelete(null);
          }
        }}
      >
        <strong>{pendingDelete?.fileName}</strong> and its {pendingDelete?.endpointCount} APIs will be removed from the database. This can&apos;t be undone.
      </ConfirmDialog>
    </section>
  );
}

export function EndpointList({ wb }) {
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const endpoints = wb.detail?.endpoints ?? [];

  const groups = useMemo(() => {
    const n = q.trim().toLowerCase();
    const match = (e) =>
      !n || [e.method, e.path, e.summary, e.operationId, ...(e.tags ?? []), `${e.method} ${e.path}`].some((v) => String(v ?? '').toLowerCase().includes(n));
    const map = new Map();
    for (const e of endpoints.filter(match)) {
      const tag = e.tags?.[0] ?? 'Other';
      if (!map.has(tag)) map.set(tag, []);
      map.get(tag).push(e);
    }
    for (const list of map.values())
      list.sort((a, b) => a.path.localeCompare(b.path) || METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method));
    return [...map.entries()];
  }, [endpoints, q]);

  const total = groups.reduce((n, [, l]) => n + l.length, 0);

  if (!wb.yamlFileId) return null;

  return (
    <section className="nav-section grow" aria-label="APIs">
      <div className="nav-section-head">
        <h3 className="eyebrow">
          APIs <span className="tabular">{endpoints.length || ''}</span>
        </h3>
        {wb.detailStatus === 'loading' && <span className="spinner" aria-label="Loading" />}
      </div>
      {endpoints.length > 0 && <SearchInput value={q} onChange={setQ} placeholder="Search path, method, name or tag…" />}
      {wb.detailStatus === 'error' ? (
        <p className="nav-empty text-bad">{wb.detail?.error?.message ?? 'This YAML file could not be read.'}</p>
      ) : wb.detailStatus === 'ready' && !endpoints.length ? (
        <p className="nav-empty">This YAML file defines no APIs.</p>
      ) : total === 0 && q ? (
        <p className="nav-empty">No API matches “{q}”.</p>
      ) : (
        <div className="endpoint-groups">
          {groups.map(([tag, list]) => {
            const isCollapsed = collapsed.has(tag) && !q;
            return (
              <div className="endpoint-group" key={tag}>
                {groups.length > 1 && (
                  <button
                    type="button"
                    className="group-toggle"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((s) => {
                        const next = new Set(s);
                        if (next.has(tag)) next.delete(tag);
                        else next.add(tag);
                        return next;
                      })
                    }
                  >
                    <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={12} />
                    {tag}
                    <span className="tabular muted">{list.length}</span>
                  </button>
                )}
                {!isCollapsed && (
                  <ul className="endpoint-list">
                    {list.map((e) => (
                      <li key={e.key}>
                        <button
                          type="button"
                          className={`endpoint-item${e.key === wb.endpointKey ? ' selected' : ''}${e.deprecated ? ' deprecated' : ''}`}
                          aria-current={e.key === wb.endpointKey ? 'true' : undefined}
                          onClick={() => wb.selectEndpoint(e.key)}
                          title={e.summary || e.operationId || `${e.method} ${e.path}`}
                        >
                          <MethodBadge method={e.method} />
                          <span className="endpoint-text">
                            <span className="endpoint-path">{e.path}</span>
                            {e.summary && <span className="endpoint-summary">{e.summary}</span>}
                          </span>
                          {e.deprecated && <Badge tone="warn">Old</Badge>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function ApiOverview({ wb }) {
  const { model, file } = wb.detail;
  const counts = {};
  for (const op of model.operations) counts[op.method] = (counts[op.method] ?? 0) + 1;
  return (
    <div className="overview">
      <div className="overview-head">
        <span className="eyebrow">{model.format === 'swagger' ? `Swagger ${model.specVersion}` : model.format === 'openapi' ? `OpenAPI ${model.specVersion}` : 'YAML'}</span>
        <h2>{model.title || file.fileName}</h2>
        {model.version && <span className="muted">Version {model.version}</span>}
      </div>
      {model.description && <p className="overview-desc">{model.description}</p>}
      <dl className="overview-facts">
        <div>
          <dt>File</dt>
          <dd className="mono">{file.filePath}</dd>
        </div>
        <div>
          <dt>Servers</dt>
          <dd className="mono">{model.servers.length ? model.servers.map((s) => s.url).join('\n') : 'None (uses Base URL from Settings)'}</dd>
        </div>
        <div>
          <dt>APIs</dt>
          <dd>
            <span className="method-counts">
              {METHOD_ORDER.filter((m) => counts[m]).map((m) => (
                <span key={m}>
                  <MethodBadge method={m} /> <span className="tabular">{counts[m]}</span>
                </span>
              ))}
            </span>
          </dd>
        </div>
        <div>
          <dt>Uploaded</dt>
          <dd>{formatDateTime(file.createdAt)}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatDateTime(file.updatedAt)}</dd>
        </div>
      </dl>
      {file.warnings?.length > 0 && (
        <details className="disclosure overview-warnings">
          <summary>
            {file.warnings.length} validation note{file.warnings.length === 1 ? '' : 's'}
          </summary>
          <ul>
            {file.warnings.map((w, i) => (
              <li key={i}>
                {w.path && <code>{w.path}</code>} {w.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <EmptyState icon="api" title="Select an API">
        Choose an API from the list to open its form.
      </EmptyState>
    </div>
  );
}
