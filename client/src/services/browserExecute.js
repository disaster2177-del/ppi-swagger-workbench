/**
 * Send a built request straight from the browser (used when the server proxy
 * is off, and in the browser-only build). Same result shape as the server's
 * /execute so the response viewer does not care which path was used.
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
    res = await fetch(req.url, { method: req.method, headers, body, signal: controller.signal, credentials: 'include' });
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      if (controller.signal.reason === 'cancelled') throw new ApiError('CANCELLED', MESSAGES.CANCELLED);
      throw new ApiError('TIMEOUT', MESSAGES.TIMEOUT);
    }
    if (isHostedArtifact()) throw new ApiError('HOSTED_NO_NETWORK', MESSAGES.HOSTED_NO_NETWORK, { details: err.message });
    throw new ApiError(
      'NETWORK',
      `${MESSAGES.NETWORK} If the service is up, the browser may have blocked it (CORS): turn on "Send requests through the server" in Settings.`,
      { details: err.message },
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
