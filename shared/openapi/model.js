/**
 * Build one normalised API model from an OpenAPI 3.x or Swagger 2.0 document.
 *
 * Everything the UI shows comes from here: the list of operations, their
 * parameters, request bodies, servers and security schemes. Nothing about a
 * particular API is hardcoded; the model is derived entirely from the document.
 */
import { deref, isObject } from './schema.js';

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];
const PARAM_LOCATIONS = ['path', 'query', 'header', 'cookie'];

/** "openapi" for 3.x, "swagger" for 2.0, null otherwise. */
export function detectFormat(def) {
  if (!isObject(def)) return null;
  if (def.openapi !== undefined) return /^3(\.\d+){0,2}$/.test(String(def.openapi)) ? 'openapi' : null;
  if (def.swagger !== undefined) return /^2(\.0)?$/.test(String(def.swagger)) ? 'swagger' : null;
  return null;
}

const SCHEMA_KEYS = [
  'type', 'format', 'items', 'enum', 'default', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'multipleOf', 'collectionFormat',
];

/** Swagger 2.0 non-body parameters keep their schema keywords on the parameter itself. */
function swaggerParamSchema(p) {
  const schema = {};
  for (const k of SCHEMA_KEYS) if (p[k] !== undefined) schema[k] = p[k];
  if (schema.type === 'file') {
    schema.type = 'string';
    schema.format = 'binary';
  }
  if (p.description) schema.description = p.description;
  return schema;
}

function firstExample(examples) {
  if (!isObject(examples)) return undefined;
  const first = Object.values(examples)[0];
  return isObject(first) && 'value' in first ? first.value : undefined;
}

function expandServer(server) {
  if (!isObject(server) || typeof server.url !== 'string') return null;
  let url = server.url;
  for (const [name, v] of Object.entries(server.variables ?? {})) {
    url = url.replaceAll(`{${name}}`, v?.default ?? '');
  }
  return { url, description: server.description ?? '' };
}

function normaliseSecurityScheme(key, s, format) {
  if (!isObject(s)) return null;
  if (format === 'swagger' && s.type === 'basic') return { key, type: 'http', scheme: 'basic', description: s.description ?? '' };
  if (s.type === 'http') return { key, type: 'http', scheme: String(s.scheme ?? 'bearer').toLowerCase(), bearerFormat: s.bearerFormat, description: s.description ?? '' };
  if (s.type === 'apiKey') return { key, type: 'apiKey', in: s.in, name: s.name, description: s.description ?? '' };
  if (s.type === 'oauth2' || s.type === 'openIdConnect') return { key, type: s.type, scheme: 'bearer', description: s.description ?? '' };
  return { key, type: s.type ?? 'unknown', description: s.description ?? '' };
}

function pathTemplateNames(path) {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

/** Merge path-level and operation-level parameters; the operation wins on the same name + location. */
function mergeParameters(pathParams = [], opParams = [], root) {
  const map = new Map();
  for (const raw of [...pathParams, ...opParams]) {
    let p;
    try {
      p = deref(raw, root);
    } catch {
      continue;
    }
    if (!isObject(p) || typeof p.name !== 'string' || typeof p.in !== 'string') continue;
    map.set(`${p.in}:${p.name}`, p);
  }
  return [...map.values()];
}

function buildOperation(format, def, path, method, pathItem, op) {
  const raw = mergeParameters(pathItem.parameters, op.parameters, def);
  const parameters = [];
  let requestBody = null;

  if (format === 'swagger') {
    const consumes = op.consumes ?? def.consumes ?? ['application/json'];
    const body = raw.find((p) => p.in === 'body');
    const form = raw.filter((p) => p.in === 'formData');
    if (body) {
      const json = consumes.find((c) => /json/i.test(c)) ?? consumes[0] ?? 'application/json';
      requestBody = {
        required: !!body.required,
        description: body.description ?? '',
        contents: [{ mediaType: json, schema: body.schema ?? {}, example: body['x-example'] }],
      };
    } else if (form.length) {
      const hasFile = form.some((p) => p.type === 'file');
      const mediaType = hasFile
        ? 'multipart/form-data'
        : consumes.find((c) => /x-www-form-urlencoded|multipart/i.test(c)) ?? 'application/x-www-form-urlencoded';
      requestBody = {
        required: form.some((p) => p.required),
        description: '',
        contents: [
          {
            mediaType,
            schema: {
              type: 'object',
              properties: Object.fromEntries(form.map((p) => [p.name, swaggerParamSchema(p)])),
              required: form.filter((p) => p.required).map((p) => p.name),
            },
          },
        ],
      };
    }
    for (const p of raw) {
      if (!PARAM_LOCATIONS.includes(p.in)) continue;
      parameters.push({
        name: p.name,
        in: p.in,
        required: p.in === 'path' ? true : !!p.required,
        description: p.description ?? '',
        deprecated: !!p.deprecated,
        schema: swaggerParamSchema(p),
        example: p['x-example'],
      });
    }
  } else {
    for (const p of raw) {
      if (!PARAM_LOCATIONS.includes(p.in)) continue;
      const media = isObject(p.content) ? Object.values(p.content)[0] : null;
      parameters.push({
        name: p.name,
        in: p.in,
        required: p.in === 'path' ? true : !!p.required,
        description: p.description ?? '',
        deprecated: !!p.deprecated,
        schema: p.schema ?? media?.schema ?? { type: 'string' },
        example: p.example ?? firstExample(p.examples) ?? media?.example,
        style: p.style,
        explode: p.explode,
      });
    }
    if (op.requestBody) {
      let rb;
      try {
        rb = deref(op.requestBody, def);
      } catch {
        rb = null;
      }
      const contents = Object.entries(rb?.content ?? {}).map(([mediaType, m]) => ({
        mediaType,
        schema: m?.schema ?? {},
        example: m?.example ?? firstExample(m?.examples),
      }));
      if (contents.length) requestBody = { required: !!rb.required, description: rb.description ?? '', contents };
    }
  }

  // Every {name} in the path needs a value, even when the document forgot to describe it.
  for (const name of pathTemplateNames(path)) {
    if (!parameters.some((p) => p.in === 'path' && p.name === name)) {
      parameters.push({ name, in: 'path', required: true, description: '', deprecated: false, schema: { type: 'string' }, undocumented: true });
    }
  }

  const responses = Object.entries(op.responses ?? {}).map(([status, r]) => {
    let resolved = r;
    try {
      resolved = deref(r, def);
    } catch {
      /* keep as-is */
    }
    return { status, description: resolved?.description ?? '' };
  });

  return {
    id: `${method.toUpperCase()} ${path}`,
    method: method.toUpperCase(),
    path,
    operationId: op.operationId ?? '',
    summary: op.summary ?? '',
    description: op.description ?? '',
    tags: Array.isArray(op.tags) && op.tags.length ? op.tags.map(String) : [],
    deprecated: !!op.deprecated,
    parameters,
    requestBody,
    security: op.security ?? def.security ?? [],
    responses,
  };
}

/** Normalised model of the whole document. Assumes the document passed validateDefinition(). */
export function buildApiModel(def) {
  const format = detectFormat(def);
  const servers =
    format === 'swagger'
      ? def.host
        ? [{ url: `${def.schemes?.[0] ?? 'https'}://${def.host}${def.basePath ?? ''}`, description: '' }]
        : def.basePath
          ? [{ url: def.basePath, description: '' }]
          : []
      : (def.servers ?? []).map(expandServer).filter(Boolean);

  const rawSchemes = format === 'swagger' ? def.securityDefinitions : def.components?.securitySchemes;
  const securitySchemes = Object.entries(rawSchemes ?? {})
    .map(([key, s]) => {
      try {
        return normaliseSecurityScheme(key, deref(s, def), format);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const operations = [];
  for (const [path, rawItem] of Object.entries(def.paths ?? {})) {
    let pathItem;
    try {
      pathItem = deref(rawItem, def);
    } catch {
      continue;
    }
    if (!isObject(pathItem)) continue;
    for (const method of HTTP_METHODS) {
      if (isObject(pathItem[method])) operations.push(buildOperation(format, def, path, method, pathItem, pathItem[method]));
    }
  }

  return {
    format,
    specVersion: String(def.openapi ?? def.swagger ?? ''),
    title: def.info?.title ?? '',
    version: def.info?.version ?? '',
    description: def.info?.description ?? '',
    servers,
    securitySchemes,
    tags: (def.tags ?? []).filter(isObject).map((t) => ({ name: String(t.name), description: t.description ?? '' })),
    operations,
    root: def,
  };
}

/** Compact endpoint records for storage and listing (no schemas). */
export function extractEndpoints(model) {
  return model.operations.map((op) => ({
    key: op.id,
    method: op.method,
    path: op.path,
    operationId: op.operationId,
    summary: op.summary,
    description: op.description.length > 500 ? `${op.description.slice(0, 497)}…` : op.description,
    tags: op.tags,
    deprecated: op.deprecated,
  }));
}
