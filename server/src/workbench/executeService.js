/**
 * Sends an API request on behalf of the browser.
 *
 * Why through the server: the browser never holds the stored credentials,
 * CORS does not get in the way, and the request timeout is enforced in one
 * place. The target is always Settings Base URL + Base Path (or the YAML
 * file's own server); the browser only supplies the endpoint path, so this
 * cannot be used to reach arbitrary hosts.
 */
import { AppError, MESSAGES, HTTP_METHODS, activeEnvironmentBase, applyAuth, buildApiModel, effectiveBase, joinUrl, parseDefinitionText } from './sharedImports.js';
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

export class ExecuteService {
  constructor({ workbench, settings, fetchImpl = globalThis.fetch }) {
    this.workbench = workbench;
    this.settings = settings;
    this.fetch = fetchImpl;
  }

  /**
   * spec = { yamlFileId, method, path, query: [[k, v]], headers: {}, body: {kind, mediaType, json|text|fields} }
   * files = multer files for multipart bodies, fieldname "file:<field>"
   */
  async execute(spec, files = []) {
    const method = String(spec?.method ?? '').toLowerCase();
    if (!HTTP_METHODS.includes(method)) throw new AppError('REQUEST_FAILED', 'Unsupported HTTP method.');
    const path = String(spec.path ?? '');
    if (!path.startsWith('/') || /^\/\//.test(path) || /[\r\n]/.test(path)) throw new AppError('REQUEST_FAILED', 'The endpoint path is not valid.');
    if (/\{[^}]+\}/.test(path)) throw new AppError('REQUIRED_FIELDS', 'Fill in every path parameter before sending.');

    const file = await this.workbench.getYamlFile(spec.yamlFileId);
    const model = buildApiModel(parseDefinitionText(file.content));
    const { settings, auth } = await this.settings.getForRequest();
    const env = activeEnvironmentBase(settings);
    const base = effectiveBase(env, model.servers);
    if (!/^https?:\/\//i.test(base)) throw new AppError('NO_BASE_URL', MESSAGES.NO_BASE_URL);

    const url = new URL(joinUrl(base, path));
    const query = Array.isArray(spec.query) ? spec.query : [];
    for (const pair of query) if (Array.isArray(pair) && pair.length === 2) url.searchParams.append(String(pair[0]), String(pair[1]));

    const headers = {};
    for (const h of settings.request.defaultHeaders) if (h.enabled !== false && h.name) headers[h.name] = h.value;
    for (const [k, v] of Object.entries(spec.headers ?? {})) {
      if (HOP_BY_HOP.test(k) || /[\r\n]/.test(String(v))) continue;
      headers[k] = String(v);
    }
    const authQuery = [];
    applyAuth(auth, headers, authQuery);
    for (const [k, v] of authQuery) url.searchParams.set(k, v);

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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.request.timeoutMs);
    const started = Date.now();
    let res;
    try {
      res = await this.fetch(url, { method: method.toUpperCase(), headers, body, signal: controller.signal, redirect: 'manual' });
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted) throw new AppError('TIMEOUT', `${MESSAGES.TIMEOUT} (limit: ${Math.round(settings.request.timeoutMs / 1000)} s)`, { status: 504 });
      logger.warn(`Proxy request to ${url.origin} failed: ${err.cause?.code ?? err.message}`);
      throw new AppError('NETWORK', MESSAGES.NETWORK, { status: 502, details: { reason: err.cause?.code ?? err.message } });
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
      if (controller.signal.aborted) throw new AppError('TIMEOUT', MESSAGES.TIMEOUT, { status: 504 });
      throw new AppError('NETWORK', MESSAGES.NETWORK, { status: 502, details: { reason: err.message } });
    } finally {
      clearTimeout(timer);
    }

    const contentType = res.headers.get('content-type') ?? '';
    const isText = !contentType || /json|text|xml|yaml|javascript|x-www-form-urlencoded|html/i.test(contentType);
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      url: maskUrl(url.toString(), auth),
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
