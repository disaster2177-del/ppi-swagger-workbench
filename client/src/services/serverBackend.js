/**
 * The parts that stay on the server (Express on the VM): shared settings,
 * the optional API request proxy and the example YAML files. Projects and
 * YAML files are not sent here.
 *
 * Sending an API request (Settings → Requests → "Send requests from"):
 *   browser (default)  the browser calls the API directly, so DevTools shows the real
 *                      GET / POST / PUT / DELETE. Needs CORS on the API. Credentials
 *                      for this mode are kept in this browser tab only.
 *   server             the browser POSTs the request to /api/workbench/execute and the
 *                      VM calls the API. No CORS limits; credentials stay on the server.
 */
import { MESSAGES } from '@workbench/shared/openapi';
import { ApiError } from './errors.js';
import { executeInBrowser } from './browserExecute.js';
import { createLocalSecrets } from './localSecrets.js';

const BASE = (import.meta.env?.VITE_API_BASE ?? '') + '/api/workbench';

async function http(method, path, { json, form, signal } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: json !== undefined ? JSON.stringify(json) : form,
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new ApiError('CANCELLED', MESSAGES.CANCELLED);
    throw new ApiError('SERVER_UNREACHABLE', "Can't reach the application server. Check that it is running.", { details: err.message });
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new ApiError(body?.code ?? `HTTP_${res.status}`, body?.message ?? MESSAGES.GENERIC, { status: res.status, details: body?.details, fields: body?.fields });
  }
  return body;
}

export function createServerBackend() {
  const local = createLocalSecrets();
  // In browser mode the "saved" flags describe this browser's credentials.
  const withFlags = (s) => (s?.request?.sendVia === 'server' ? s : local.flags(s));

  return {
    kind: 'server',
    supportsProxy: true,

    settings: {
      get: async () => withFlags(await http('GET', '/settings')),
      save: async (settings, secrets = {}) => {
        if (settings?.request?.sendVia === 'server') return withFlags(await http('PUT', '/settings', { json: { settings, secrets } }));
        local.apply(secrets);
        return withFlags(await http('PUT', '/settings', { json: { settings, secrets: {} } }));
      },
    },

    samples: () => http('GET', '/samples'),

    /**
     * req: built request without credentials; rebuild(auth): the same request with credentials;
     * serverUrl: the YAML's first server; files: { field: File } for multipart;
     * via: 'browser' | 'server' to override Settings for this one call.
     */
    async execute({ req, rebuild, serverUrl, files = {}, settings, signal, via }) {
      const mode = via ?? settings?.request?.sendVia ?? 'browser';
      if (mode !== 'server') {
        const withAuth = rebuild ? rebuild({ ...settings.auth, ...local.get() }) : req;
        return executeInBrowser(withAuth, { timeoutMs: settings?.request?.timeoutMs, files, signal });
      }
      const spec = { method: req.method, path: req.path, query: req.query, headers: req.headers, body: req.body, serverUrl };
      if (req.body?.kind === 'multipart') {
        const form = new FormData();
        const fields = req.body.fields.filter(([, v]) => !(v instanceof Blob));
        form.append('request', JSON.stringify({ ...spec, body: { ...req.body, fields } }));
        for (const [k, f] of Object.entries(files)) form.append(`file:${k}`, f, f.name);
        return http('POST', '/execute', { form, signal });
      }
      return http('POST', '/execute', { json: spec, signal });
    },
  };
}
