import { useMemo, useRef, useState } from 'react';
import { describeHttpStatus, toCurl } from '@workbench/shared/openapi';
import { Badge, Button, CopyButton, EmptyState, Icon, SearchInput, StatusCode, Tabs, formatBytes } from '../../ui/index.jsx';
import { describeDetails } from '../../services/errors.js';

const PAGE = 50;

function parseJson(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function cell(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Arrays of objects as a filterable table. */
function ResultTable({ rows }) {
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const columns = useMemo(() => {
    const keys = [];
    for (const r of rows.slice(0, 200)) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
    return keys.slice(0, 10);
  }, [rows]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(n)) : rows;
  }, [rows, q]);
  return (
    <div className="result-table">
      <div className="result-toolbar">
        <span className="muted tabular">
          {filtered.length.toLocaleString()} {filtered.length === 1 ? 'result' : 'results'}
        </span>
        {rows.length > 6 && <SearchInput value={q} onChange={(v) => (setQ(v), setLimit(PAGE))} placeholder="Filter results…" />}
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c} className="mono">
                    {cell(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > limit && (
        <Button size="sm" onClick={() => setLimit(limit + PAGE)}>
          Show more ({(filtered.length - limit).toLocaleString()} left)
        </Button>
      )}
    </div>
  );
}

function HeaderTable({ rows }) {
  if (!rows.length) return <p className="muted">None.</p>;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={`${k}-${i}`}>
              <th scope="row" style={{ position: 'static', textTransform: 'none', letterSpacing: 0 }}>
                {k}
              </th>
              <td className="mono" style={{ wordBreak: 'break-all' }}>
                {/^(authorization|cookie|x-api-key)$/i.test(k) ? '••••••' : v}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ResponseViewer({ response, onClear }) {
  const [tab, setTab] = useState('body');
  const [view, setView] = useState('auto');
  const curlRef = useRef(null);
  const req = response.request;
  const curl = useMemo(() => (req ? toCurl(req) : ''), [req]);

  if (response.failure) {
    return (
      <section className="response card" aria-label="Response">
        <div className="response-head">
          <h3 className="eyebrow">Response</h3>
          <Button size="sm" variant="ghost" icon="x" onClick={onClear}>
            Clear
          </Button>
        </div>
        <div className="callout bad">
          <Icon name="error" />
          <div>
            <strong>API request failed.</strong>
            <div>{response.failure.message}</div>
            {response.failure.details && (
              <details className="disclosure" style={{ marginTop: 6 }}>
                <summary>Technical details</summary>
                <pre className="code-block">{describeDetails(response.failure.details)}</pre>
              </details>
            )}
          </div>
        </div>
        {req && (
          <>
            <h4 className="eyebrow">curl</h4>
            <pre className="code-block" ref={curlRef}>
              {curl}
            </pre>
          </>
        )}
      </section>
    );
  }

  const json = parseJson(response.body);
  const tableRows = json.ok && Array.isArray(json.value) && json.value.length && json.value.every(isPlainObject) ? json.value : null;
  const effectiveView = view === 'auto' ? (tableRows ? 'table' : 'pretty') : view;
  const statusInfo = !response.ok ? describeHttpStatus(response.status) : null;

  return (
    <section className="response card" aria-label="Response">
      <div className="response-head">
        <div className="response-status">
          <StatusCode status={response.status} />
          <span className="response-text">{response.statusText}</span>
          <span className="muted tabular">{response.durationMs} ms</span>
          <span className="muted tabular">{formatBytes(response.sizeBytes)}</span>
          {response.viaProxy ? <Badge tone="info">via server</Badge> : <Badge>from browser</Badge>}
          {response.truncated && <Badge tone="warn">truncated at 5 MB</Badge>}
        </div>
        <Button size="sm" variant="ghost" icon="x" onClick={onClear}>
          Clear
        </Button>
      </div>

      {statusInfo && (
        <div className="callout warn">
          <Icon name="alert" />
          <div>
            <strong>{statusInfo.title}</strong>
            <div>{statusInfo.hint}</div>
          </div>
        </div>
      )}

      <Tabs
        label="Response sections"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'body', label: 'Body' },
          { id: 'headers', label: `Headers (${response.headers.length})` },
          { id: 'request', label: 'Request' },
        ]}
      />

      {tab === 'body' && (
        <div className="response-panel">
          {response.body == null && response.bodyBase64 ? (
            <p className="muted">Binary response ({response.contentType || 'unknown type'}), {formatBytes(response.sizeBytes)}.</p>
          ) : !response.body ? (
            <EmptyState icon="file" title="Empty response body" />
          ) : json.ok ? (
            <>
              <div className="response-tools">
                <Tabs
                  label="Body view"
                  value={effectiveView}
                  onChange={setView}
                  items={[...(tableRows ? [{ id: 'table', label: 'Table' }] : []), { id: 'pretty', label: 'JSON' }, { id: 'raw', label: 'Raw' }]}
                />
                <CopyButton text={response.body} />
              </div>
              {effectiveView === 'table' && tableRows ? (
                <ResultTable rows={tableRows} />
              ) : (
                <pre className="code-block">{effectiveView === 'raw' ? response.body : JSON.stringify(json.value, null, 2)}</pre>
              )}
            </>
          ) : (
            <>
              <div className="response-tools">
                <span className="muted">{response.contentType}</span>
                <CopyButton text={response.body} />
              </div>
              <pre className="code-block">{response.body}</pre>
            </>
          )}
        </div>
      )}

      {tab === 'headers' && (
        <div className="response-panel">
          <HeaderTable rows={response.headers} />
          {!response.viaProxy && (
            <p className="field-help">
              Browsers only expose some response headers. Send requests through the server (Settings → Request) to see all of them.
            </p>
          )}
        </div>
      )}

      {tab === 'request' && req && (
        <div className="response-panel">
          <h4 className="eyebrow">Request URL</h4>
          <pre className="code-block">
            {req.method} {response.url || req.url}
          </pre>
          <h4 className="eyebrow">Request headers</h4>
          <HeaderTable rows={Object.entries(req.headers)} />
          {req.bodyPreview !== undefined && (
            <>
              <h4 className="eyebrow">Request body</h4>
              <pre className="code-block">{req.bodyPreview}</pre>
            </>
          )}
          <div className="response-tools">
            <h4 className="eyebrow">curl</h4>
            <CopyButton text={curl} targetRef={curlRef} />
          </div>
          <pre className="code-block" ref={curlRef}>
            {curl}
          </pre>
          {response.viaProxy && <p className="field-help">The server adds the saved credentials, so they are not shown here.</p>}
        </div>
      )}
    </section>
  );
}
