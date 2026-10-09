/**
 * The parts that stay on the server (Express on the VM): shared settings,
 * the API request proxy and the example YAML files. Projects and YAML files
 * are not sent here.
 */
import { MESSAGES } from '@workbench/shared/openapi';
import { ApiError } from './errors.js';
import { executeInBrowser } from './browserExecute.js';

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
  return {
    kind: 'server',
    supportsProxy: true,

    settings: {
      get: () => http('GET', '/settings'),
      save: (settings, secrets) => http('PUT', '/settings', { json: { settings, secrets } }),
    },

    samples: () => http('GET', '/samples'),

    /**
     * req: built request (shared buildRequest); serverUrl: the YAML's first server;
     * files: { field: File } for multipart; forceBrowser: skip the proxy for this one call.
     */
    async execute({ req, serverUrl, files = {}, settings, signal, forceBrowser }) {
      if (forceBrowser || settings?.request?.useServerProxy === false) {
        return executeInBrowser(req, { timeoutMs: settings?.request?.timeoutMs, files, signal });
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
