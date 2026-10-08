/**
 * Data source backed by the Express API and MongoDB (the normal setup).
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
  if (!res.ok && !(res.status === 422 && body?.results)) {
    throw new ApiError(body?.code ?? `HTTP_${res.status}`, body?.message ?? MESSAGES.GENERIC, {
      status: res.status,
      details: body?.details,
      fields: body?.fields,
    });
  }
  return body;
}

export function createRestSource() {
  return {
    kind: 'server',
    label: 'Server database (MongoDB)',
    supportsProxy: true,
    maxFileSizeKb: Infinity,

    projects: {
      list: () => http('GET', '/projects'),
      create: (data) => http('POST', '/projects', { json: data }),
      update: (id, data) => http('PATCH', `/projects/${encodeURIComponent(id)}`, { json: data }),
      remove: (id) => http('DELETE', `/projects/${encodeURIComponent(id)}`),
    },

    yamlFiles: {
      list: (projectId, search = '') =>
        http('GET', `/projects/${encodeURIComponent(projectId)}/yaml-files${search ? `?search=${encodeURIComponent(search)}` : ''}`),
      get: (id) => http('GET', `/yaml-files/${encodeURIComponent(id)}`),
      remove: (id) => http('DELETE', `/yaml-files/${encodeURIComponent(id)}`),
      upload: (projectId, files) => {
        const form = new FormData();
        for (const f of files) form.append('files', f, f.name);
        return http('POST', `/projects/${encodeURIComponent(projectId)}/yaml-files`, { form });
      },
    },

    settings: {
      get: () => http('GET', '/settings'),
      save: (settings, secrets) => http('PUT', '/settings', { json: { settings, secrets } }),
    },

    /** req: built request (shared buildRequest); files: { field: File } for multipart. */
    async execute({ yamlFileId, req, files = {}, settings, signal }) {
      if (settings?.request?.useServerProxy === false) return executeInBrowser(req, { timeoutMs: settings.request.timeoutMs, files, signal });
      const spec = { yamlFileId, method: req.method, path: req.path, query: req.query, headers: req.headers, body: req.body };
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
