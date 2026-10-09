/**
 * The selected YAML file rendered by the official Swagger UI (swagger-ui-dist):
 * tags, operations, "Try it out", Authorize, schemas and examples exactly as
 * Swagger shows them. Loaded on demand so the rest of the app stays small.
 *
 * What this adds on top of plain Swagger UI:
 *  - Settings → Base URL / Base Path become the first server in the list
 *  - Settings → default headers and credentials are added to every request
 *  - Settings → "Send requests from: The server" routes Try it out through
 *    POST /api/workbench/execute (no CORS limits) and shows the real response
 *  - no internet access: the online validator badge is switched off
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { applyAuth, joinUrl } from '@workbench/shared/openapi';
import { activeEnvironment } from '@workbench/shared/settings';
import { EmptyState } from '../../ui/index.jsx';

const EXECUTE_PATH = '/api/workbench/execute';
const PROXY_MARK = 'x-workbench-proxied-url';

/** Copy of the definition whose servers reflect Settings (Base URL + Base Path). */
export function specWithSettings(definition, settings) {
  const spec = JSON.parse(JSON.stringify(definition));
  const env = activeEnvironment(settings);
  const baseUrl = env?.baseUrl?.trim();
  const basePath = env?.basePath?.trim();

  if (spec.swagger) {
    if (baseUrl) {
      try {
        const u = new URL(baseUrl);
        spec.host = u.host;
        spec.schemes = [u.protocol.replace(':', '')];
        spec.basePath = joinUrl(u.pathname === '/' ? '' : u.pathname, basePath || '') || '/';
      } catch {
        /* relative base URL: leave the definition alone */
      }
    } else if (basePath) {
      spec.basePath = joinUrl(spec.basePath ?? '', basePath);
    }
    return spec;
  }

  const servers = Array.isArray(spec.servers) ? spec.servers : [];
  if (baseUrl) {
    spec.servers = [{ url: joinUrl(baseUrl, basePath || ''), description: `Settings: ${env.name}` }, ...servers];
  } else if (basePath && servers.length) {
    spec.servers = servers.map((s) => ({ ...s, url: joinUrl(s.url, basePath) }));
  }
  return spec;
}

function hasHeader(headers, name) {
  return Object.keys(headers ?? {}).some((k) => k.toLowerCase() === name.toLowerCase());
}

export default function SwaggerView({ wb, settings }) {
  const host = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const definition = wb.detail?.model?.root;
  const viaServer = wb.source?.supportsProxy && settings.request.sendVia === 'server';

  // Re-render Swagger UI only when something it shows actually changes.
  const spec = useMemo(() => (definition ? specWithSettings(definition, settings) : null), [definition, settings]);
  const live = useRef({});
  live.current = { settings, viaServer, wb };

  useEffect(() => {
    if (!spec || !host.current) return undefined;
    let cancelled = false;
    const node = host.current;
    setStatus('loading');

    (async () => {
      try {
        const [mod] = await Promise.all([import('swagger-ui-dist/swagger-ui-es-bundle.js'), import('swagger-ui-dist/swagger-ui.css')]);
        const SwaggerUIBundle = mod.default ?? mod;
        if (cancelled) return;
        node.innerHTML = '';
        SwaggerUIBundle({
          domNode: node,
          spec,
          deepLinking: false,
          docExpansion: 'list',
          defaultModelsExpandDepth: 0,
          displayRequestDuration: true,
          filter: true,
          tryItOutEnabled: true,
          persistAuthorization: true,
          showExtensions: true,
          showCommonExtensions: true,
          validatorUrl: null, // no call to validator.swagger.io (works offline)
          syntaxHighlight: { activated: true, theme: 'agate' },

          requestInterceptor: (req) => {
            const { settings: s, viaServer: proxy } = live.current;
            req.headers = req.headers ?? {};
            for (const h of s.request.defaultHeaders ?? []) {
              if (h.enabled !== false && h.name && !hasHeader(req.headers, h.name)) req.headers[h.name] = h.value;
            }
            if (req.url.includes(EXECUTE_PATH) || req.loadSpec) return req;
            live.current.lastRequest = { method: String(req.method ?? 'GET').toUpperCase(), url: req.url };

            if (!proxy) {
              // Browser mode: Settings credentials, unless the user authorized in Swagger UI.
              if (!hasHeader(req.headers, 'Authorization')) {
                const query = [];
                applyAuth(live.current.wb.source.browserAuth(s), req.headers, query);
                if (query.length) {
                  const u = new URL(req.url);
                  for (const [k, v] of query) if (!u.searchParams.has(k)) u.searchParams.set(k, v);
                  req.url = u.toString();
                }
              }
              return req;
            }

            // Server mode: send the request to the VM, which calls the API (adds its stored credentials).
            if (req.body && typeof req.body !== 'string') return req; // file uploads: send from the browser
            const contentType = Object.entries(req.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1];
            const target = req.url;
            const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.toLowerCase() !== 'content-type'));
            req.body = JSON.stringify({
              method: req.method,
              url: target,
              headers,
              body: req.body ? { kind: 'text', mediaType: contentType ?? 'application/json', text: req.body } : undefined,
            });
            req.url = `${window.location.origin}${import.meta.env?.VITE_API_BASE ?? ''}${EXECUTE_PATH}`;
            req.headers = { 'Content-Type': 'application/json', [PROXY_MARK]: target };
            req.method = 'POST';
            return req;
          },

          responseInterceptor: (res) => {
            const { wb: w } = live.current;
            const proxied = !!res.url?.includes(EXECUTE_PATH);
            if (proxied) {
              // Unwrap the proxy's answer so Swagger UI shows the API's own status, headers and body.
              const out = res.obj ?? (() => {
                try {
                  return JSON.parse(res.text);
                } catch {
                  return null;
                }
              })();
              if (out && typeof out.status === 'number') {
                res.status = out.status;
                res.statusText = out.statusText;
                res.ok = out.ok;
                res.headers = Object.fromEntries(out.headers ?? []);
                res.text = out.body ?? '';
                res.data = res.text;
                try {
                  res.obj = JSON.parse(res.text);
                  res.body = res.obj;
                } catch {
                  res.obj = undefined;
                  res.body = res.text;
                }
                res.url = out.url;
              } else if (out?.message) {
                if (live.current.lastRequest) res.url = live.current.lastRequest.url;
                res.text = JSON.stringify({ error: out.message, ...(out.details ? { details: out.details } : {}) }, null, 2);
                res.data = res.text;
                res.obj = JSON.parse(res.text);
                res.body = res.obj;
              }
            }
            if (live.current.lastRequest && !res.url?.startsWith('blob:')) {
              let path = res.url;
              try {
                path = new URL(res.url).pathname;
              } catch {
                /* keep */
              }
              w.recordExecution({
                at: new Date().toISOString(),
                method: live.current.lastRequest?.method ?? 'API',
                path,
                status: res.status,
                ok: res.ok,
                yamlFileId: w.yamlFileId,
                endpointKey: '',
                fileName: w.detail?.file?.fileName,
              });
              live.current.lastRequest = null;
            }
            return res;
          },
        });
        if (!cancelled) setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err?.message ?? String(err));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      node.innerHTML = '';
    };
  }, [spec]);

  if (!definition) return null;
  return (
    <div className="swagger-host">
      <div className="swagger-bar">
        <span className="muted">
          {viaServer ? (
            <>
              Try it out is sent <strong>through the server</strong> (DevTools shows <code>POST {EXECUTE_PATH}</code>).
            </>
          ) : (
            <>
              Try it out is sent <strong>from your browser</strong> (DevTools shows the real request). The API must allow CORS.
            </>
          )}{' '}
          Base URL and credentials from Settings are applied.
        </span>
      </div>
      {status === 'loading' && <EmptyState icon="refresh" title="Loading Swagger UI…" />}
      {status === 'error' && (
        <EmptyState icon="error" title="Swagger UI could not be loaded">
          {error}
        </EmptyState>
      )}
      <div ref={host} className="swagger-root" />
    </div>
  );
}
