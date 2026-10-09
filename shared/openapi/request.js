/**
 * Turn an operation plus form values into a concrete HTTP request.
 *
 * URL = Base URL + Base Path + endpoint path, e.g.
 *   https://api.example.com + /api/v1 + /users/{id}  →  https://api.example.com/api/v1/users/42
 * When Settings has no Base URL, the first server from the YAML file is used.
 */
import { isObject, resolveSchema } from './schema.js';
import { cleanValue } from './values.js';

/** Join URL parts with exactly one "/" between them. Keeps "https://" intact. */
export function joinUrl(...parts) {
  const cleaned = parts.filter((p) => typeof p === 'string' && p.trim() !== '').map((p) => p.trim());
  if (!cleaned.length) return '';
  return cleaned
    .map((p, i) => {
      let s = p;
      if (i > 0) s = s.replace(/^\/+/, '');
      if (i < cleaned.length - 1) s = s.replace(/\/+$/, '');
      return s;
    })
    .filter((s, i) => s !== '' || i === 0)
    .join('/');
}

/** Base for requests: Settings Base URL, else the definition's first server. Base Path is always appended. */
export function effectiveBase({ baseUrl = '', basePath = '' } = {}, servers = []) {
  const base = baseUrl.trim() || servers[0]?.url || '';
  return joinUrl(base, basePath);
}

function fillPath(path, values = {}) {
  return path.replace(/\{([^}]+)\}/g, (_, name) => {
    const v = values[name];
    return v === undefined || v === '' ? `{${name}}` : encodeURIComponent(String(v));
  });
}

function serialiseQueryValue(v) {
  if (isObject(v)) return JSON.stringify(v);
  return String(v);
}

/** Header values must be single-line text. Returns the offending header name or null. */
/**
 * Build the request description.
 *  operation   normalised operation (model.js)
 *  values      { path: {}, query: {}, header: {}, cookie: {} }
 *  body        body value (object/array/primitive or a raw string for raw mode)
 *  contentType selected media type
 *  settings    { baseUrl, basePath, defaultHeaders: [{name, value, enabled}] }
 *  auth        { type, token, username, password, apiKeyName, apiKeyIn, apiKeyValue } — only in the browser-only build;
 *              the server adds credentials itself and the browser never holds them.
 */
export function buildRequest({ operation, values = {}, body, rawBody, contentType, settings = {}, servers = [], auth = null, root }) {
  const base = effectiveBase(settings, servers);
  const path = fillPath(operation.path, values.path);
  const query = [];
  for (const [k, v] of Object.entries(values.query ?? {})) {
    const c = cleanValue(v);
    if (c === undefined) continue;
    if (Array.isArray(c)) c.forEach((item) => query.push([k, serialiseQueryValue(item)]));
    else query.push([k, serialiseQueryValue(c)]);
  }

  const headers = {};
  for (const h of settings.defaultHeaders ?? []) {
    if (h && h.enabled !== false && h.name) headers[h.name] = String(h.value ?? '');
  }
  for (const [k, v] of Object.entries(values.header ?? {})) {
    const c = cleanValue(v);
    if (c !== undefined) headers[k] = Array.isArray(c) ? c.join(',') : String(c);
  }
  const cookies = {};
  for (const [k, v] of Object.entries(values.cookie ?? {})) {
    const c = cleanValue(v);
    if (c !== undefined) cookies[k] = String(c);
  }

  if (auth) applyAuth(auth, headers, query);

  let bodyPayload;
  let bodyPreview;
  const hasBody = !!operation.requestBody && !['GET', 'HEAD'].includes(operation.method);
  if (hasBody) {
    const mediaType = contentType ?? operation.requestBody.contents[0]?.mediaType ?? 'application/json';
    if (typeof rawBody === 'string') {
      if (rawBody.trim()) {
        bodyPayload = { kind: 'text', mediaType, text: rawBody };
        bodyPreview = rawBody;
        headers['Content-Type'] ??= mediaType;
      }
    } else {
      const cleaned = cleanValue(body);
      if (cleaned !== undefined) {
        if (/json/i.test(mediaType)) {
          bodyPayload = { kind: 'json', mediaType, json: cleaned };
          bodyPreview = JSON.stringify(cleaned, null, 2);
          headers['Content-Type'] ??= mediaType;
        } else if (/x-www-form-urlencoded/i.test(mediaType)) {
          const pairs = Object.entries(isObject(cleaned) ? cleaned : {}).map(([k, v]) => [k, isObject(v) || Array.isArray(v) ? JSON.stringify(v) : String(v)]);
          bodyPayload = { kind: 'form', mediaType, fields: pairs };
          bodyPreview = new URLSearchParams(pairs).toString();
          headers['Content-Type'] ??= mediaType;
        } else if (/multipart\/form-data/i.test(mediaType)) {
          const fields = Object.entries(isObject(cleaned) ? cleaned : {});
          bodyPayload = { kind: 'multipart', mediaType, fields };
          bodyPreview = fields.map(([k, v]) => `${k}: ${isFileLike(v) ? `<file ${v.name}>` : isObject(v) ? JSON.stringify(v) : v}`).join('\n');
          // The browser / fetch sets the multipart boundary itself.
        } else {
          const text = typeof cleaned === 'string' ? cleaned : JSON.stringify(cleaned);
          bodyPayload = { kind: 'text', mediaType, text };
          bodyPreview = text;
          headers['Content-Type'] ??= mediaType;
        }
      }
    }
  }

  const qs = new URLSearchParams(query).toString();
  const url = `${joinUrl(base, path) || path}${qs ? `?${qs}` : ''}`;
  if (Object.keys(cookies).length) headers.Cookie = Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');

  return {
    method: operation.method,
    url,
    base,
    path,
    query,
    headers,
    cookies,
    body: bodyPayload,
    bodyPreview,
    missingBase: !base,
    unresolvedPath: /\{[^}]+\}/.test(path),
  };
}

function isFileLike(v) {
  return v && typeof v === 'object' && typeof v.name === 'string' && typeof v.size === 'number';
}

export function applyAuth(auth, headers, query) {
  if (!auth || auth.type === 'none') return;
  if (auth.type === 'bearer' && auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (auth.type === 'basic' && (auth.username || auth.password)) {
    const raw = `${auth.username ?? ''}:${auth.password ?? ''}`;
    const enc = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(raw))) : Buffer.from(raw).toString('base64');
    headers.Authorization = `Basic ${enc}`;
  }
  if (auth.type === 'apiKey' && auth.apiKeyName && auth.apiKeyValue) {
    if (auth.apiKeyIn === 'query') query.push([auth.apiKeyName, auth.apiKeyValue]);
    else headers[auth.apiKeyName] = auth.apiKeyValue;
  }
}

const SECRET_HEADERS = /^(authorization|cookie|x-api-key|api[-_]?key|proxy-authorization)$/i;

/** curl equivalent; secrets are masked unless `revealSecrets`. */
export function toCurl(req, { revealSecrets = false } = {}) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const lines = [`curl -X ${req.method} ${q(req.url)}`];
  for (const [k, v] of Object.entries(req.headers)) {
    lines.push(`  -H ${q(`${k}: ${!revealSecrets && SECRET_HEADERS.test(k) ? '••••••' : v}`)}`);
  }
  if (req.body?.kind === 'json') lines.push(`  --data ${q(JSON.stringify(req.body.json))}`);
  else if (req.body?.kind === 'text') lines.push(`  --data ${q(req.body.text)}`);
  else if (req.body?.kind === 'form') lines.push(`  --data ${q(new URLSearchParams(req.body.fields).toString())}`);
  else if (req.body?.kind === 'multipart')
    for (const [k, v] of req.body.fields) lines.push(`  -F ${q(`${k}=${isFileLike(v) ? `@${v.name}` : isObject(v) ? JSON.stringify(v) : v}`)}`);
  return lines.join(' \\\n');
}

/** Does this schema (after $ref) describe something a form can show? Used to pick form vs raw JSON mode. */
export function isFormFriendly(schema, root) {
  const { schema: s, recursive, error } = resolveSchema(schema, root);
  if (error || recursive) return false;
  return s.type !== undefined || Array.isArray(s.oneOf) || Array.isArray(s.anyOf);
}

/**
 * When the base already ends with the segment the endpoint starts with
 * (Base URL ".../v1/users" + endpoint "/users" → ".../v1/users/users"),
 * return that segment so the UI can warn. Not changed automatically:
 * some APIs really do repeat a segment.
 */
export function duplicatedSegment(base, path) {
  let basePath = base ?? '';
  try {
    basePath = new URL(base).pathname;
  } catch {
    /* relative base */
  }
  const last = basePath.replace(/\/+$/, '').split('/').pop();
  const first = String(path ?? '').replace(/^\/+/, '').split(/[/?]/)[0];
  return last && first && !first.startsWith('{') && last.toLowerCase() === first.toLowerCase() ? last : null;
}
