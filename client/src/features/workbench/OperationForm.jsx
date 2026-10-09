/**
 * The form for one API operation, generated from the YAML/OpenAPI definition:
 * path / query / header / cookie parameters and the request body, with
 * validation, sample data, a live request preview and Execute.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MESSAGES,
  buildRequest,
  describeHttpStatus,
  effectiveBase,
  initialValue,
  duplicatedSegment,
  isFormFriendly,
  resolveSchema,
  widgetFor,
  sampleValue,
  validateValue,
} from '@workbench/shared/openapi';
import { activeEnvironment } from '@workbench/shared/settings';
import { Badge, Button, ConfirmDialog, CopyButton, Field, Icon, MethodBadge, Select, Tabs, useToast } from '../../ui/index.jsx';
import { toUserError } from '../../services/errors.js';
import SchemaField, { fieldId } from './SchemaField.jsx';
import ResponseViewer from './ResponseViewer.jsx';

const LOCATIONS = [
  ['path', 'Path parameters'],
  ['query', 'Query parameters'],
  ['header', 'Headers'],
  ['cookie', 'Cookies'],
];

function freshState(operation, root) {
  const values = { path: {}, query: {}, header: {}, cookie: {} };
  for (const p of operation.parameters) {
    const v = initialValue(p.schema, root);
    if (v !== undefined) values[p.in][p.name] = v;
  }
  const content = operation.requestBody?.contents[0];
  const body = content ? content.example ?? initialValue(content.schema, root) : undefined;
  return {
    values,
    body,
    rawBody: '',
    bodyMode: content && !isFormFriendly(content.schema, root) ? 'json' : 'form',
    contentType: content?.mediaType,
    errors: {},
    response: null,
  };
}

function collectFiles(body) {
  const files = {};
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const [k, v] of Object.entries(body)) if (typeof File !== 'undefined' && v instanceof File) files[k] = v;
  }
  return files;
}

export default function OperationForm({ wb, settings, onOpenSettings }) {
  const toast = useToast();
  const { operation, detail } = wb;
  const model = detail.model;
  const root = model.root;
  const cacheKey = `${wb.yamlFileId}::${operation.id}`;
  const [state, setState] = useState(() => wb.forms.get(cacheKey) ?? freshState(operation, root));
  const [sending, setSending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const abortRef = useRef(null);

  // Switch operation: restore its cached state (form values survive navigation).
  useEffect(() => {
    setState(wb.forms.get(cacheKey) ?? freshState(operation, root));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);
  useEffect(() => {
    wb.forms.set(cacheKey, state);
  }, [wb.forms, cacheKey, state]);

  const patch = useCallback((p) => setState((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) })), []);
  const setParam = (loc, name, v) =>
    patch((s) => {
      const group = { ...s.values[loc] };
      if (v === undefined || v === '') delete group[name];
      else group[name] = v;
      return { values: { ...s.values, [loc]: group } };
    });

  const content = operation.requestBody?.contents.find((c) => c.mediaType === state.contentType) ?? operation.requestBody?.contents[0];
  const jsonBody = content && /json/i.test(content.mediaType);
  const bodyIsObject = !!content && widgetFor(resolveSchema(content.schema, root).schema) === 'object';
  const env = activeEnvironment(settings);
  const base = effectiveBase(env, model.servers);
  // Which way Execute goes: the browser itself (real GET/POST/... in DevTools) or the server proxy.
  const sentVia = (override) => (wb.source.supportsProxy ? override ?? settings.request.sendVia ?? 'browser' : 'browser');
  const dup = duplicatedSegment(base, operation.path);
  const baseSource = env.baseUrl ? `Base URL from Settings (${env.name})` : model.servers[0] ? 'Server from the YAML file' : null;

  const preview = useMemo(
    () =>
      buildRequest({
        operation,
        values: state.values,
        body: state.bodyMode === 'form' ? state.body : undefined,
        rawBody: state.bodyMode === 'json' ? state.rawBody : undefined,
        contentType: content?.mediaType,
        settings: { baseUrl: env.baseUrl, basePath: env.basePath, defaultHeaders: settings.request.defaultHeaders },
        servers: model.servers,
        root,
      }),
    [operation, state.values, state.body, state.rawBody, state.bodyMode, content, env, settings.request.defaultHeaders, model.servers, root],
  );

  const needsAuth = operation.security?.length > 0 && settings.auth.type === 'none';
  const schemeNames = [...new Set((operation.security ?? []).flatMap((req) => Object.keys(req ?? {})))];

  // ---------------------------------------------------------------- validation
  const validate = () => {
    const errors = {};
    for (const p of operation.parameters) {
      Object.assign(errors, validateValue(p.schema, state.values[p.in][p.name], root, { path: `${p.in}.${p.name}`, required: p.required }));
    }
    let parsedRaw;
    if (content) {
      if (state.bodyMode === 'json') {
        if (state.rawBody.trim()) {
          try {
            parsedRaw = JSON.parse(state.rawBody);
          } catch (err) {
            errors.body = `The request body is not valid JSON: ${err.message}`;
          }
        }
        if (!errors.body) {
          const bodyErrors = validateValue(content.schema, parsedRaw, root, { path: 'body', required: operation.requestBody.required });
          // In JSON mode there are no per-field inputs, so list the problems under the editor.
          const list = Object.entries(bodyErrors).map(([k, m]) => `${k.replace(/^body\.?/, '') || 'body'}: ${m}`);
          if (list.length) errors.body = list.slice(0, 8).join('\n') + (list.length > 8 ? `\n…and ${list.length - 8} more` : '');
        }
      } else {
        Object.assign(errors, validateValue(content.schema, state.body, root, { path: 'body', required: operation.requestBody.required }));
      }
    }
    return errors;
  };

  const focusFirstError = (errors) => {
    const first = Object.keys(errors)[0];
    if (!first) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(first === 'body' ? 'fld-body-json' : fieldId(first)) ?? document.querySelector('.field.invalid input, .field.invalid select, .field.invalid textarea');
      el?.focus?.();
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    });
  };

  // ---------------------------------------------------------------- execute
  const execute = async ({ via } = {}) => {
    const errors = validate();
    patch({ errors });
    if (Object.keys(errors).length) {
      const missing = Object.values(errors).some((m) => /required|at least one/i.test(m));
      const n = Object.keys(errors).length;
      toast.error(missing ? MESSAGES.REQUIRED_FIELDS : n === 1 ? 'Please fix the highlighted field.' : `Please fix the ${n} highlighted fields.`);
      focusFirstError(errors);
      return;
    }
    if (!base && !preview.url.startsWith('http')) {
      toast.error(MESSAGES.NO_BASE_URL);
      return;
    }

    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const started = new Date().toISOString();
    const files = collectFiles(state.bodyMode === 'form' ? state.body : undefined);
    try {
      const result = await wb.source.execute({
        req: preview,
        serverUrl: model.servers[0]?.url,
        via,
        files,
        settings,
        signal: controller.signal,
        // browser-only builds add credentials themselves
        rebuild: (auth) =>
          buildRequest({
            operation,
            values: state.values,
            body: state.bodyMode === 'form' ? state.body : undefined,
            rawBody: state.bodyMode === 'json' ? state.rawBody : undefined,
            contentType: content?.mediaType,
            settings: { baseUrl: env.baseUrl, basePath: env.basePath, defaultHeaders: settings.request.defaultHeaders },
            servers: model.servers,
            auth,
            root,
          }),
      });
      patch({ response: { ...result, request: preview, at: started } });
      wb.recordExecution({ at: started, method: operation.method, path: preview.path, status: result.status, ok: result.ok, durationMs: result.durationMs, yamlFileId: wb.yamlFileId, endpointKey: operation.id, fileName: detail.file.fileName });
      if (result.ok) {
        toast.success(`${result.status} ${result.statusText || 'OK'}`, { message: `${MESSAGES.REQUEST_OK} ${operation.method} ${preview.path} · ${result.durationMs} ms` });
      } else {
        const d = describeHttpStatus(result.status);
        toast.error(MESSAGES.REQUEST_FAILED, { message: `${result.status} ${result.statusText ?? ''} — ${d?.title ?? ''}. ${d?.hint ?? ''}`.trim() });
      }
    } catch (err) {
      const e = toUserError(err, 'REQUEST_FAILED');
      if (e.code === 'CANCELLED') {
        toast.info(MESSAGES.CANCELLED);
      } else {
        patch({ response: { failure: e, request: preview, at: started, viaProxy: sentVia(via) === 'server' } });
        wb.recordExecution({ at: started, method: operation.method, path: preview.path, status: 0, ok: false, error: e.message, yamlFileId: wb.yamlFileId, endpointKey: operation.id, fileName: detail.file.fileName });
        toast.error(MESSAGES.REQUEST_FAILED, { message: e.message, details: e.details });
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (sending) return;
    if (operation.method === 'DELETE') setConfirmDelete(true);
    else execute();
  };

  const fillSample = () => {
    const values = { path: {}, query: {}, header: {}, cookie: {} };
    for (const p of operation.parameters) {
      const v = p.example ?? sampleValue(p.schema, root, { name: p.name });
      if (v !== undefined && v !== '') values[p.in][p.name] = v;
    }
    const body = content ? content.example ?? sampleValue(content.schema, root) : undefined;
    patch({ values, body, rawBody: body === undefined ? '' : JSON.stringify(body, null, 2), errors: {} });
  };

  const reset = () => setState((s) => ({ ...freshState(operation, root), response: s.response }));

  const switchBodyMode = (mode) => {
    if (mode === state.bodyMode) return;
    if (mode === 'json') {
      patch({ bodyMode: 'json', rawBody: state.body === undefined ? '' : JSON.stringify(state.body, null, 2), errors: {} });
    } else {
      try {
        patch({ bodyMode: 'form', body: state.rawBody.trim() ? JSON.parse(state.rawBody) : undefined, errors: {} });
      } catch {
        toast.error('The JSON is not valid, so it cannot be shown as a form.', { message: 'Fix the JSON or clear it first.' });
      }
    }
  };

  const params = operation.parameters;
  const hasInputs = params.length > 0 || !!content;
  const title = operation.summary || operation.operationId || `${operation.method} ${operation.path}`;

  return (
    <div className="op">
      <header className="op-head">
        <div className="op-line">
          <MethodBadge method={operation.method} />
          <code className="op-path">{operation.path}</code>
          {operation.deprecated && <Badge tone="warn">Deprecated</Badge>}
        </div>
        <h2 className="op-title">{title}</h2>
        {operation.description && operation.description !== operation.summary && <p className="op-desc">{operation.description}</p>}
        <div className="op-meta">
          {operation.tags.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
          {operation.operationId && <span className="field-key">{operation.operationId}</span>}
        </div>
      </header>

      {needsAuth && (
        <div className="callout warn" role="note">
          <Icon name="key" />
          <div>
            This API expects credentials ({schemeNames.join(', ') || 'security'}). Add them in Settings → Authentication.{' '}
            <button type="button" className="btn-link" onClick={onOpenSettings}>
              Open Settings
            </button>
          </div>
        </div>
      )}

      <form className="op-form card" noValidate onSubmit={onSubmit}>
        {!hasInputs && <p className="muted">This API takes no parameters. Press Execute to send it.</p>}

        {LOCATIONS.map(([loc, heading]) => {
          const list = params.filter((p) => p.in === loc);
          if (!list.length) return null;
          return (
            <section className="op-section" key={loc} aria-label={heading}>
              <h3 className="eyebrow">{heading}</h3>
              <div className="form-grid">
                {list.map((p) => (
                  <SchemaField
                    key={`${loc}:${p.name}`}
                    schema={p.schema}
                    root={root}
                    name={p.name}
                    label={p.schema?.title}
                    description={p.description || (p.undocumented ? 'Not described in the YAML file.' : undefined)}
                    example={p.example}
                    deprecated={p.deprecated}
                    value={state.values[loc][p.name]}
                    onChange={(v) => setParam(loc, p.name, v)}
                    path={`${loc}.${p.name}`}
                    required={p.required}
                    errors={state.errors}
                  />
                ))}
              </div>
            </section>
          );
        })}

        {content && (
          <section className="op-section" aria-label="Request body">
            <div className="op-section-head">
              <h3 className="eyebrow">
                Request body {operation.requestBody.required ? <span className="field-req">*</span> : <span className="field-tag">Optional</span>}
              </h3>
              <div className="op-section-tools">
                {operation.requestBody.contents.length > 1 && (
                  <Select size="sm" aria-label="Content type" value={content.mediaType} onChange={(e) => patch({ contentType: e.target.value, errors: {} })}>
                    {operation.requestBody.contents.map((c) => (
                      <option key={c.mediaType} value={c.mediaType}>
                        {c.mediaType}
                      </option>
                    ))}
                  </Select>
                )}
                {jsonBody && (
                  <Tabs
                    label="Body editor"
                    value={state.bodyMode}
                    onChange={switchBodyMode}
                    items={[
                      { id: 'form', label: 'Form' },
                      { id: 'json', label: 'JSON' },
                    ]}
                  />
                )}
              </div>
            </div>
            {operation.requestBody.description && <p className="field-help">{operation.requestBody.description}</p>}
            {state.bodyMode === 'json' ? (
              <Field id="fld-body-json" label="JSON" error={state.errors.body} help={`Sent as ${content.mediaType}. Checked against the schema before sending.`}>
                <textarea
                  id="fld-body-json"
                  className="textarea code"
                  rows={12}
                  spellCheck={false}
                  value={state.rawBody}
                  placeholder="{ }"
                  onChange={(e) => patch({ rawBody: e.target.value })}
                />
              </Field>
            ) : (
              <SchemaField
                schema={content.schema}
                root={root}
                name="body"
                label="Request body"
                bare={bodyIsObject}
                value={state.body}
                onChange={(v) => patch({ body: v })}
                path="body"
                required={operation.requestBody.required}
                errors={state.errors}
              />
            )}
          </section>
        )}

        <section className="op-preview" aria-label="Request URL">
          <div className="op-section-head">
            <h3 className="eyebrow">Request URL</h3>
            <CopyButton text={preview.url} />
          </div>
          <div className="op-url">
            <MethodBadge method={operation.method} />
            <code>{preview.url || operation.path}</code>
          </div>
          <p className="field-help">
            {baseSource ? (
              <>
                {baseSource}
                {env.basePath ? ` + base path ${env.basePath}` : ''} + endpoint path.{' '}
              </>
            ) : (
              <>
                No Base URL yet.{' '}
                <button type="button" className="btn-link" onClick={onOpenSettings}>
                  Set it in Settings
                </button>
                .{' '}
              </>
            )}
            {preview.unresolvedPath && <span className="text-warn">Fill in every path parameter.</span>}
          </p>
          {dup && (
            <div className="callout warn" role="note">
              <Icon name="alert" />
              <div>
                The address repeats <code>/{dup}</code>: the {env.baseUrl ? 'Base URL' : 'server in the YAML file'} already ends with <code>/{dup}</code> and the endpoint
                starts with it. If that is not intended, remove <code>/{dup}</code> from the {env.baseUrl ? 'Base URL in Settings' : 'YAML server'}.{' '}
                {env.baseUrl && (
                  <button type="button" className="btn-link" onClick={onOpenSettings}>
                    Open Settings
                  </button>
                )}
              </div>
            </div>
          )}
          <p className="field-help send-via">
            {sentVia() === 'server' ? (
              <>
                <Icon name="globe" size={12} /> Sent through the server (DevTools shows <code>POST /api/workbench/execute</code>).
              </>
            ) : (
              <>
                <Icon name="globe" size={12} /> Sent directly from your browser as <code>{operation.method}</code> (visible in DevTools → Network).
              </>
            )}{' '}
            {wb.source.supportsProxy && (
              <button type="button" className="btn-link" onClick={onOpenSettings}>
                Change
              </button>
            )}
          </p>
        </section>

        <div className="op-actions">
          <div className="op-actions-left">
            {hasInputs && (
              <>
                <Button variant="ghost" size="sm" icon="refresh" onClick={fillSample} disabled={sending}>
                  Use sample data
                </Button>
                <Button variant="ghost" size="sm" onClick={reset} disabled={sending}>
                  Reset
                </Button>
              </>
            )}
          </div>
          {sending ? (
            <Button onClick={() => abortRef.current?.abort()} loading>
              Sending… Cancel
            </Button>
          ) : (
            <Button type="submit" variant={operation.method === 'DELETE' ? 'danger' : 'primary'} icon="play">
              Execute
            </Button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={confirmDelete}
        title={`Send ${operation.method} request?`}
        danger
        confirmLabel="Yes, send it"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          execute();
        }}
      >
        <p>
          <code>
            {operation.method} {preview.url}
          </code>
        </p>
        <p style={{ marginTop: 8 }}>This usually deletes data and can&apos;t be undone.</p>
      </ConfirmDialog>

      {state.response && (
        <ResponseViewer
          response={state.response}
          onClear={() => patch({ response: null })}
          onRetry={
            wb.source.supportsProxy && ['NETWORK', 'TIMEOUT'].includes(state.response.failure?.code)
              ? { via: state.response.viaProxy ? 'browser' : 'server', run: () => execute({ via: state.response.viaProxy ? 'browser' : 'server' }) }
              : null
          }
          retrying={sending}
        />
      )}
    </div>
  );
}
