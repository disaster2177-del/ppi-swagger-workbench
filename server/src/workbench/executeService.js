/**
 * Sends an API request on behalf of the browser.
 *
 * Why through the server: the browser never holds the stored credentials,
 * CORS does not get in the way, and the request timeout is enforced in one
 * place.
 *
 * Target URL = Settings Base URL (active environment), or else the server
 * from the YAML file (sent by the browser as `serverUrl`), + Base Path +
 * endpoint path + query. YAML files live in each user's browser, so the
 * server never stores them.
 *
 * Outbound restrictions (env):
 *   WORKBENCH_ALLOWED_HOSTS  comma list of host names (or *.suffix) the proxy may call; empty = any
 *   Cloud metadata addresses (169.254.0.0/16) are always refused.
 * Outbound HTTP proxy: set HTTPS_PROXY / HTTP_PROXY / NO_PROXY and NODE_USE_ENV_PROXY=1.
 */
import { AppError, MESSAGES, HTTP_METHODS, activeEnvironmentBase, applyAuth, effectiveBase, joinUrl } from './sharedImports.js';
import { causeCode, describeNetworkError } from './networkErrors.js';
import logger from '../logger.js';

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const HOP_BY_HOP = /^(host|connection|keep-alive|proxy-.*|te|trailer|transfer-encoding|upgrade|content-length)$/i;
const SECRET_QUERY = /^(api[-_]?key|access[-_]?token|token|key|secret)$/i;

function maskUrl(url, auth) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (SECRET_QUERY.test(k) || (auth?.apiKeyIn === 'query' && k === auth.apiKeyName)) u.searchParams.set(k, '••••••');
    }
    return u.toString();
  } catch {
    return url;
  }
}

function allowedHosts() {
  return (process.env.WORKBENCH_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function checkTarget(url) {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (/^169\.254\./.test(host) || host === 'metadata.google.internal') {
    throw new AppError('TARGET_BLOCKED', 'Requests to cloud metadata addresses are not allowed.', { status: 403 });
  }
  const list = allowedHosts();
  if (list.length && !list.some((h) => (h.startsWith('*.') ? host.endsWith(h.slice(1)) : host === h))) {
    throw new AppError('TARGET_BLOCKED', `This server is not allowed to call "${host}". An administrator can add it to WORKBENCH_ALLOWED_HOSTS.`, {
      status: 403,
    });
  }
}

export class ExecuteService {
  constructor({ settings, fetchImpl = globalThis.fetch }) {
    this.settings = settings;
    this.fetch = fetchImpl;
  }

  /** Build the final URL without sending anything (used by /execute and the tests). */
  async resolveUrl(spec) {
    // Swagger UI view: the browser already resolved the full URL (servers + Base URL from Settings).
    if (typeof spec?.url === 'string' && spec.url) {
      const { settings, auth } = await this.settings.getForRequest();
      let url;
      try {
        url = new URL(spec.url);
      } catch {
        throw new AppError('NO_BASE_URL', `"${spec.url}" is not a valid address.`);
      }
      if (!/^https?:$/.test(url.protocol)) throw new AppError('NO_BASE_URL', 'Only http:// and https:// addresses can be called.');
      return { url, settings, auth };
    }
    const path = String(spec?.path ?? '');
    if (!path.startsWith('/') || /^\/\//.test(path) || /[\r\n]/.test(path)) throw new AppError('REQUEST_FAILED', 'The endpoint path is not valid.');
    if (/\{[^}]+\}/.test(path)) throw new AppError('REQUIRED_FIELDS', 'Fill in every path parameter before sending.');
    const { settings, auth } = await this.settings.getForRequest();
    const servers = typeof spec.serverUrl === 'string' && spec.serverUrl.trim() ? [{ url: spec.serverUrl.trim() }] : [];
    const base = effectiveBase(activeEnvironmentBase(settings), servers);
    if (!/^https?:\/\//i.test(base)) throw new AppError('NO_BASE_URL', MESSAGES.NO_BASE_URL);
    let url;
    try {
      url = new URL(joinUrl(base, path));
    } catch {
      throw new AppError('NO_BASE_URL', `The Base URL "${base}" is not a valid address.`);
    }
    const query = Array.isArray(spec.query) ? spec.query : [];
    for (const pair of query) if (Array.isArray(pair) && pair.length === 2) url.searchParams.append(String(pair[0]), String(pair[1]));
    return { url, settings, auth };
  }

  /**
   * spec = { method, path, query: [[k, v]], headers: {}, body: {kind, mediaType, json|text|fields}, serverUrl? }
   *     or { method, url, headers, body }  (full URL, from the Swagger UI view)
   * files = multer files for multipart bodies, fieldname "file:<field>"
   */
  async execute(spec, files = []) {
    const method = String(spec?.method ?? '').toLowerCase();
    if (!HTTP_METHODS.includes(method)) throw new AppError('REQUEST_FAILED', 'Unsupported HTTP method.');
    const { url, settings, auth } = await this.resolveUrl(spec);

    const headers = {};
    for (const h of settings.request.defaultHeaders) if (h.enabled !== false && h.name) headers[h.name] = h.value;
    for (const [k, v] of Object.entries(spec.headers ?? {})) {
      if (HOP_BY_HOP.test(k) || /[\r\n]/.test(String(v))) continue;
      headers[k] = String(v);
    }
    const authQuery = [];
    applyAuth(auth, headers, authQuery);
    for (const [k, v] of authQuery) url.searchParams.set(k, v);
    checkTarget(url);

    let body;
    const b = spec.body;
    if (b && !['get', 'head'].includes(method)) {
      if (b.kind === 'json') body = JSON.stringify(b.json);
      else if (b.kind === 'text') body = String(b.text ?? '');
      else if (b.kind === 'form') body = new URLSearchParams(b.fields ?? []).toString();
      else if (b.kind === 'multipart') {
        const form = new FormData();
        for (const [k, v] of b.fields ?? []) form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
        for (const f of files) {
          const field = f.fieldname.replace(/^file:/, '');
          form.append(field, new Blob([f.buffer], { type: f.mimetype }), f.originalname);
        }
        body = form;
        delete headers['Content-Type'];
        delete headers['content-type'];
      }
      if (b.kind !== 'multipart' && b.mediaType && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = b.mediaType;
    }

    const shownUrl = maskUrl(url.toString(), auth);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.request.timeoutMs);
    const started = Date.now();
    let res;
    try {
      res = await this.fetch(url, { method: method.toUpperCase(), headers, body, signal: controller.signal, redirect: 'manual' });
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw new AppError('TIMEOUT', `${MESSAGES.TIMEOUT} (limit: ${Math.round(settings.request.timeoutMs / 1000)} s)`, {
          status: 504,
          details: { url: shownUrl, reason: 'TIMEOUT' },
        });
      }
      const code = causeCode(err);
      const d = describeNetworkError(code, url.toString());
      logger.warn(`Proxy request ${method.toUpperCase()} ${shownUrl} failed: ${code}`);
      throw new AppError('NETWORK', `${d.title} ${d.hint}`, { status: 502, details: { url: shownUrl, reason: code } });
    }

    let buffer;
    let truncated = false;
    try {
      const reader = res.body?.getReader();
      const chunks = [];
      let size = 0;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_RESPONSE_BYTES) {
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
      buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    } catch (err) {
      if (controller.signal.aborted) throw new AppError('TIMEOUT', MESSAGES.TIMEOUT, { status: 504, details: { url: shownUrl } });
      throw new AppError('NETWORK', MESSAGES.NETWORK, { status: 502, details: { url: shownUrl, reason: causeCode(err) } });
    } finally {
      clearTimeout(timer);
    }

    const contentType = res.headers.get('content-type') ?? '';
    const isText = !contentType || /json|text|xml|yaml|javascript|x-www-form-urlencoded|html/i.test(contentType);
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      url: shownUrl,
      headers: [...res.headers.entries()],
      contentType,
      body: isText ? buffer.toString('utf8') : null,
      bodyBase64: isText ? null : buffer.toString('base64'),
      sizeBytes: buffer.length,
      truncated,
      durationMs: Date.now() - started,
      viaProxy: true,
    };
  }
}
