/**
 * Structural validation of an OpenAPI 3.x / Swagger 2.0 document.
 *
 * Checks what the app relies on (version field, paths, operations,
 * parameters, resolvable local $refs) and reports problems as
 * { path, message } pairs a person can act on. Modes:
 *   strict   - must be OpenAPI/Swagger; warnings also block the upload
 *   standard - must be OpenAPI/Swagger; warnings are reported only
 *   lenient  - any YAML object is accepted; endpoints come from `paths` if present
 */
import { detectFormat, HTTP_METHODS } from './model.js';
import { deref, isObject, resolvePointer } from './schema.js';

const SWAGGER_LOCATIONS = ['path', 'query', 'header', 'body', 'formData'];
const OPENAPI_LOCATIONS = ['path', 'query', 'header', 'cookie'];
const MAX_REPORTED = 25;

function collectRefs(node, at, out, depth = 0) {
  if (depth > 64 || out.length > 5000) return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectRefs(v, `${at}/${i}`, out, depth + 1));
  } else if (isObject(node)) {
    if (typeof node.$ref === 'string') out.push({ ref: node.$ref, at });
    for (const [k, v] of Object.entries(node)) if (k !== '$ref') collectRefs(v, `${at}/${k}`, out, depth + 1);
  }
}

export function validateDefinition(def, { mode = 'standard' } = {}) {
  const errors = [];
  const warnings = [];
  const err = (path, message) => errors.push({ path, message });
  const warn = (path, message) => warnings.push({ path, message });
  const requireSpec = mode !== 'lenient';

  if (!isObject(def)) {
    err('', 'The document is not a YAML object.');
    return result();
  }

  const format = detectFormat(def);
  if (!format) {
    if (def.openapi !== undefined) err('openapi', `Unsupported OpenAPI version "${def.openapi}". Use 3.0 or 3.1.`);
    else if (def.swagger !== undefined) err('swagger', `Unsupported Swagger version "${def.swagger}". Use 2.0.`);
    else (requireSpec ? err : warn)('', 'Missing the "openapi" (3.x) or "swagger" (2.0) version field.');
  }

  if (format || requireSpec) {
    if (!isObject(def.info)) warn('info', 'Missing the "info" section (title and version).');
    else {
      if (!def.info.title) warn('info.title', 'Missing "info.title".');
      if (def.info.version === undefined) warn('info.version', 'Missing "info.version".');
    }
  }

  const is31 = format === 'openapi' && /^3\.1/.test(String(def.openapi));
  if (def.paths === undefined) {
    if (requireSpec && !(is31 && (def.webhooks || def.components))) err('paths', 'Missing the "paths" section, so there are no APIs to show.');
  } else if (!isObject(def.paths)) {
    err('paths', '"paths" must be a map of URL paths to operations.');
  } else {
    validatePaths(def, format, err, warn);
  }

  // Every local $ref must point at something; external refs are not supported.
  const refs = [];
  collectRefs(def, '#', refs);
  for (const { ref, at } of refs) {
    if (!ref.startsWith('#')) {
      err(at.slice(2).replace(/\//g, '.'), `External reference "${ref}" is not supported. Bundle the definition into one file.`);
      continue;
    }
    try {
      resolvePointer(def, ref);
    } catch {
      err(at.slice(2).replace(/\//g, '.'), `Reference "${ref}" points to nothing in this file.`);
    }
  }

  return result();

  function result() {
    const blocking = mode === 'strict' ? [...errors, ...warnings] : errors;
    return {
      valid: blocking.length === 0,
      format: isObject(def) ? detectFormat(def) : null,
      version: isObject(def) ? String(def.openapi ?? def.swagger ?? '') : '',
      errors: (mode === 'strict' ? blocking : errors).slice(0, MAX_REPORTED),
      warnings: (mode === 'strict' ? [] : warnings).slice(0, MAX_REPORTED),
      errorCount: blocking.length,
    };
  }
}

function validatePaths(def, format, err, warn) {
  const locations = format === 'swagger' ? SWAGGER_LOCATIONS : OPENAPI_LOCATIONS;
  const operationIds = new Map();

  for (const [path, rawItem] of Object.entries(def.paths)) {
    const at = `paths.${path}`;
    if (!path.startsWith('/')) err(at, `Path "${path}" must start with "/".`);
    let item;
    try {
      item = deref(rawItem, def);
    } catch (e) {
      err(at, e.message);
      continue;
    }
    if (!isObject(item)) {
      err(at, 'Each path must map to an object of operations.');
      continue;
    }
    const templateNames = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);

    const checkParams = (params, where) => {
      if (params === undefined) return [];
      if (!Array.isArray(params)) {
        err(where, '"parameters" must be a list.');
        return [];
      }
      const out = [];
      params.forEach((raw, i) => {
        let p;
        try {
          p = deref(raw, def);
        } catch {
          return; // reported by the $ref check
        }
        const pAt = `${where}[${i}]`;
        if (!isObject(p)) return err(pAt, 'Each parameter must be an object.');
        if (typeof p.name !== 'string' || !p.name) err(pAt, 'Parameter is missing "name".');
        if (!locations.includes(p.in)) err(pAt, `Parameter "${p.name ?? i}" has an invalid "in" value "${p.in}". Use one of: ${locations.join(', ')}.`);
        if (p.in === 'path' && p.required !== true) warn(pAt, `Path parameter "${p.name}" should be marked required.`);
        if (p.in === 'path' && p.name && !templateNames.includes(p.name)) warn(pAt, `Path parameter "${p.name}" does not appear in "${path}".`);
        out.push(p);
      });
      return out;
    };

    const shared = checkParams(item.parameters, `${at}.parameters`);
    let operations = 0;
    for (const method of HTTP_METHODS) {
      if (item[method] === undefined) continue;
      const opAt = `${at}.${method}`;
      const op = item[method];
      if (!isObject(op)) {
        err(opAt, 'Each operation must be an object.');
        continue;
      }
      operations += 1;
      const own = checkParams(op.parameters, `${opAt}.parameters`);
      const declared = new Set([...shared, ...own].filter((p) => isObject(p) && p.in === 'path').map((p) => p.name));
      for (const name of templateNames) {
        if (!declared.has(name)) warn(opAt, `Path parameter "{${name}}" is not described. It will be shown as a plain text field.`);
      }
      if (op.operationId) {
        if (operationIds.has(op.operationId)) warn(opAt, `operationId "${op.operationId}" is also used by ${operationIds.get(op.operationId)}.`);
        else operationIds.set(op.operationId, `${method.toUpperCase()} ${path}`);
      }
      if (format && op.responses === undefined) warn(opAt, 'Operation has no "responses".');
      if (format === 'swagger' && Array.isArray(op.parameters)) {
        const bodies = op.parameters.filter((p) => isObject(p) && p.in === 'body').length;
        if (bodies > 1) err(opAt, 'An operation can have only one "body" parameter.');
      }
    }
    if (!operations) warn(at, 'This path has no operations (get, post, put, ...).');
  }
}
