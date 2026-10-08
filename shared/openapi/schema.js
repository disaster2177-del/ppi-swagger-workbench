/**
 * JSON Schema helpers for OpenAPI 3.x / Swagger 2.0 schemas.
 *
 * resolveSchema() turns any schema node into a flat, self-describing schema
 * the form renderer and validator can read directly: $ref chains followed,
 * allOf merged, single-variant oneOf/anyOf collapsed, `nullable` / type arrays
 * / const normalised, and a missing `type` inferred.
 */

export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Follow a local JSON pointer ("#/components/schemas/Pet"). External refs are not supported. */
export function resolvePointer(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#')) {
    throw new Error(`Only local $ref values are supported ("${ref}")`);
  }
  const parts = ref
    .slice(1)
    .split('/')
    .filter((p, i) => i > 0 || p !== '')
    .map((p) => decodeURIComponent(p).replace(/~1/g, '/').replace(/~0/g, '~'));
  let node = root;
  for (const part of parts) {
    if (!isObject(node) && !Array.isArray(node)) throw new Error(`$ref "${ref}" cannot be resolved`);
    node = node[part];
    if (node === undefined) throw new Error(`$ref "${ref}" cannot be resolved`);
  }
  return node;
}

/** Follow $ref on a non-schema node (parameter, request body, response). */
export function deref(node, root, seen = []) {
  let current = node;
  while (isObject(current) && typeof current.$ref === 'string') {
    if (seen.includes(current.$ref)) throw new Error(`Circular $ref "${current.$ref}"`);
    seen = [...seen, current.$ref];
    const { $ref, ...rest } = current;
    current = { ...resolvePointer(root, $ref), ...rest };
  }
  return current;
}

const isNullSchema = (s) => isObject(s) && (s.type === 'null' || (Array.isArray(s.enum) && s.enum.length === 1 && s.enum[0] === null));

/** Merge `src` into `target` (used for allOf). Properties merge, required unions, other keys keep the first value. */
function mergeInto(target, src) {
  for (const [key, value] of Object.entries(src)) {
    if (key === 'properties' && isObject(value)) target.properties = { ...(target.properties ?? {}), ...value };
    else if (key === 'required' && Array.isArray(value)) target.required = [...new Set([...(target.required ?? []), ...value])];
    else if (target[key] === undefined) target[key] = value;
  }
}

/**
 * Resolve a schema node.
 * Returns { schema, refs, recursive, error } where `recursive` is true when
 * this schema refers back to one of its ancestors (`ancestors` = refs already
 * open above it), so callers can stop expanding.
 */
export function resolveSchema(input, root, ancestors = []) {
  let schema = isObject(input) ? input : {};
  const refs = [];
  let recursive = false;

  while (typeof schema.$ref === 'string') {
    const ref = schema.$ref;
    if (refs.includes(ref)) return { schema: {}, refs, recursive: true, error: `Circular $ref "${ref}"` };
    if (ancestors.includes(ref)) recursive = true;
    refs.push(ref);
    let target;
    try {
      target = resolvePointer(root, ref);
    } catch (err) {
      return { schema: {}, refs, recursive, error: err.message };
    }
    const { $ref: _ignored, ...siblings } = schema;
    schema = { ...(isObject(target) ? target : {}), ...siblings };
  }

  schema = { ...schema };
  const open = [...ancestors, ...refs];

  if (Array.isArray(schema.allOf)) {
    const { allOf, ...rest } = schema;
    const merged = {};
    mergeInto(merged, rest);
    for (const part of allOf) {
      const r = resolveSchema(part, root, open);
      if (r.error) return { schema: {}, refs, recursive, error: r.error };
      recursive ||= r.recursive;
      mergeInto(merged, r.schema);
    }
    schema = merged;
  }

  for (const key of ['oneOf', 'anyOf']) {
    if (!Array.isArray(schema[key])) continue;
    const variants = schema[key].filter((v) => !isNullSchema(v));
    if (variants.length !== schema[key].length) schema.nullable = true;
    if (variants.length === 1 && !schema.properties) {
      const { [key]: _drop, ...rest } = schema;
      const r = resolveSchema(variants[0], root, open);
      if (r.error) return { schema: {}, refs, recursive, error: r.error };
      const merged = { ...rest };
      mergeInto(merged, r.schema);
      refs.push(...r.refs);
      recursive ||= r.recursive;
      schema = merged;
    } else {
      schema[key] = variants;
    }
  }

  if (Array.isArray(schema.type)) {
    if (schema.type.includes('null')) schema.nullable = true;
    schema.type = schema.type.find((t) => t !== 'null');
  }
  if (schema.const !== undefined && !schema.enum) schema.enum = [schema.const];
  if (Array.isArray(schema.enum)) {
    const values = schema.enum.filter((v) => v !== null);
    if (values.length !== schema.enum.length) schema.nullable = true;
    if (values.length) schema.enum = values;
    else delete schema.enum;
  }
  if (!schema.type) {
    if (schema.properties || schema.additionalProperties) schema.type = 'object';
    else if (schema.items) schema.type = 'array';
    else if (schema.enum) schema.type = typeof schema.enum[0] === 'number' ? 'number' : typeof schema.enum[0] === 'boolean' ? 'boolean' : 'string';
  }

  return { schema, refs, recursive };
}

/** A readable name for a variant in a oneOf/anyOf list. */
export function variantLabel(variant, root, index) {
  if (isObject(variant) && typeof variant.$ref === 'string') return variant.$ref.split('/').pop();
  const r = resolveSchema(variant, root);
  return r.schema.title ?? (r.schema.type ? `${r.schema.type[0].toUpperCase()}${r.schema.type.slice(1)}` : `Option ${index + 1}`);
}

/** Which input a resolved schema needs. */
export function widgetFor(schema) {
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) return 'variant';
  if (Array.isArray(schema.enum) && schema.type !== 'boolean') return 'enum';
  switch (schema.type) {
    case 'boolean':
      return 'boolean';
    case 'integer':
    case 'number':
      return 'number';
    case 'array':
      return 'array';
    case 'object':
      return schema.properties && Object.keys(schema.properties).length ? 'object' : 'json';
    case 'string':
      if (schema.format === 'binary') return 'file';
      return 'string';
    case 'file': // Swagger 2.0 formData file
      return 'file';
    default:
      return schema.properties ? 'object' : 'json';
  }
}

/** Turn "user_id" / "userId" / "user-id" into "User ID". */
export function humanize(name = '') {
  const words = String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (['id', 'url', 'uri', 'api', 'ip', 'uuid', 'json', 'xml', 'http', 'sku'].includes(lower)) return lower.toUpperCase();
      return i === 0 ? lower[0].toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

/**
 * Display form of an enum value. Plain lowercase words are made readable
 * ("in_progress" → "In progress", "active" → "Active"); anything else —
 * codes like "USD", "payment.created", dates, short tokens — is shown as-is.
 */
export function enumLabel(value) {
  if (typeof value !== 'string') return String(value);
  if (!/^[a-z][a-z0-9]*([_-][a-z0-9]+)*$/.test(value)) return value;
  if (!/[_-]/.test(value) && value.length <= 3) return value;
  return humanize(value) || value;
}
