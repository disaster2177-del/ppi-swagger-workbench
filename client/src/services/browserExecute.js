/**
 * Send a built request straight from the browser: DevTools → Network shows
 * the real request (GET /users, PUT /users/42, ...). Same result shape as the
 * server's /execute so the response viewer does not care which path was used.
 * Cookies of this app are not sent (credentials: 'omit'), which also keeps
 * the CORS requirements on the target API as simple as possible.
 */
import { MESSAGES } from '@workbench/shared/openapi';
import { ApiError } from './errors.js';

const isHostedArtifact = () => typeof window !== 'undefined' && !!window.claude && typeof window.claude.use === 'function';

export async function executeInBrowser(req, { timeoutMs = 30000, files = {}, signal } = {}) {
  if (req.missingBase || !/^https?:\/\//i.test(req.url) && !req.url.startsWith('/')) throw new ApiError('NO_BASE_URL', MESSAGES.NO_BASE_URL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  signal?.addEventListener('abort', () => controller.abort('cancelled'));

  const headers = { ...req.headers };
  delete headers.Cookie; // browsers refuse to set Cookie from script
  let body;
  if (req.body?.kind === 'json') body = JSON.stringify(req.body.json);
  else if (req.body?.kind === 'text') body = req.body.text;
  else if (req.body?.kind === 'form') body = new URLSearchParams(req.body.fields).toString();
  else if (req.body?.kind === 'multipart') {
    body = new FormData();
    for (const [k, v] of req.body.fields) body.append(k, v instanceof Blob ? v : typeof v === 'object' ? JSON.stringify(v) : String(v));
    for (const [k, f] of Object.entries(files)) body.append(k, f);
    delete headers['Content-Type'];
  }

  const started = performance.now();
  let res;
  try {
    res = await fetch(req.url, { method: req.method, headers, body, signal: controller.signal, credentials: 'omit' });
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      if (controller.signal.reason === 'cancelled') throw new ApiError('CANCELLED', MESSAGES.CANCELLED);
      throw new ApiError('TIMEOUT', MESSAGES.TIMEOUT, { details: { url: req.url, reason: 'TIMEOUT' } });
    }
    if (isHostedArtifact()) throw new ApiError('HOSTED_NO_NETWORK', MESSAGES.HOSTED_NO_NETWORK, { details: err.message });
    let host = req.url;
    try {
      host = new URL(req.url, window.location.href).host;
    } catch {
      /* keep url */
    }
    throw new ApiError(
      'NETWORK',
      `Your browser could not complete the request to ${host}. Either this PC cannot reach it (wrong address, DNS, VPN), or the API does not allow requests from this page (CORS). The browser console shows which.`,
      { details: { url: req.url, reason: err.message } },
    );
  }
  const text = await res.text().catch(() => '');
  clearTimeout(timer);
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    url: req.url,
    headers: [...res.headers.entries()],
    contentType: res.headers.get('content-type') ?? '',
    body: text,
    sizeBytes: new Blob([text]).size,
    truncated: false,
    durationMs: Math.round(performance.now() - started),
    viaProxy: false,
  };
}
