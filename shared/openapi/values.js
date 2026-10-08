/**
 * Form values against JSON schemas: initial values (defaults), sample values
 * (examples), cleaning (drop what the user left empty) and validation.
 *
 * All rules are read from the schema; nothing is specific to one API.
 */
import { enumLabel, isObject, resolveSchema } from './schema.js';

const MAX_DEPTH = 8;

export const isEmpty = (v) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (isObject(v) && Object.keys(v).length === 0);

/** Value to pre-fill: the schema's default (recursively for objects), else undefined. */
export function initialValue(schema, root, depth = 0, ancestors = []) {
  const { schema: s, refs, recursive } = resolveSchema(schema, root, ancestors);
  if (recursive || depth > MAX_DEPTH) return undefined;
  if (s.default !== undefined) return structuredCloneSafe(s.default);
  if (s.type === 'object' && isObject(s.properties)) {
    const out = {};
    for (const [k, child] of Object.entries(s.properties)) {
      const v = initialValue(child, root, depth + 1, [...ancestors, ...refs]);
      if (v !== undefined) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

/** Realistic sample from example → default → enum → type/format. Used by "Use sample data". */
export function sampleValue(schema, root, { name = '', depth = 0, ancestors = [] } = {}) {
  const { schema: s, refs, recursive } = resolveSchema(schema, root, ancestors);
  if (recursive || depth > MAX_DEPTH) return undefined;
  if (s.example !== undefined) return structuredCloneSafe(s.example);
  if (Array.isArray(s.examples) && s.examples.length) return structuredCloneSafe(s.examples[0]);
  if (s.default !== undefined) return structuredCloneSafe(s.default);
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  const open = [...ancestors, ...refs];
  const variants = s.oneOf ?? s.anyOf;
  if (Array.isArray(variants) && variants.length) return sampleValue(variants[0], root, { name, depth, ancestors: open });

  switch (s.type) {
    case 'boolean':
      return true;
    case 'integer':
    case 'number': {
      let n = typeof s.minimum === 'number' ? s.minimum : /id$/i.test(name) ? 1 : 10;
      if (typeof s.exclusiveMinimum === 'number') n = s.exclusiveMinimum + 1;
      else if (s.exclusiveMinimum === true) n += 1;
      if (typeof s.maximum === 'number' && n > s.maximum) n = s.maximum;
      return s.type === 'integer' ? Math.round(n) : n;
    }
    case 'array': {
      const item = sampleValue(s.items ?? {}, root, { name, depth: depth + 1, ancestors: open });
      const count = Math.max(1, s.minItems ?? 1);
      return item === undefined ? [] : Array.from({ length: count }, (_, i) => (typeof item === 'number' ? item + i : item));
    }
    case 'object': {
      if (!isObject(s.properties)) return {};
      const out = {};
      for (const [k, child] of Object.entries(s.properties)) {
        const r = resolveSchema(child, root, open);
        if (r.schema.readOnly) continue;
        const v = sampleValue(child, root, { name: k, depth: depth + 1, ancestors: open });
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    case 'string':
    default:
      return sampleString(s, name);
  }
}

function sampleString(s, name) {
  const today = new Date().toISOString();
  switch (s.format) {
    case 'date':
      return today.slice(0, 10);
    case 'date-time':
      return `${today.slice(0, 19)}Z`;
    case 'time':
      return '12:00:00';
    case 'email':
      return 'user@example.com';
    case 'uri':
    case 'url':
      return 'https://example.com';
    case 'uuid':
      return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    case 'ipv4':
      return '192.0.2.1';
    case 'binary':
      return undefined;
    case 'password':
      return '';
    default: {
      let v = name ? name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : 'text';
      if (/^\^?[0-9[\]\\d{},+-]+\$?$/.test(s.pattern ?? '')) v = '12345';
      if (typeof s.minLength === 'number' && v.length < s.minLength) v = v.padEnd(s.minLength, 'x');
      if (typeof s.maxLength === 'number' && v.length > s.maxLength) v = v.slice(0, s.maxLength);
      return v;
    }
  }
}

/** Drop empty strings, empty objects and untouched optional values so they are not sent. */
export function cleanValue(value) {
  if (Array.isArray(value)) return value.map(cleanValue).filter((v) => v !== undefined);
  if (isObject(value) && !(typeof File !== 'undefined' && value instanceof File)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const c = cleanValue(v);
      if (c !== undefined && !(isObject(c) && !Object.keys(c).length && !(typeof File !== 'undefined' && c instanceof File))) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (value === '' || value === undefined) return undefined;
  return value;
}

const FORMAT_CHECKS = {
  email: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address.'],
  uri: [/^[a-z][a-z0-9+.-]*:\S+$/i, 'Enter a full URL, starting with https://'],
  url: [/^[a-z][a-z0-9+.-]*:\S+$/i, 'Enter a full URL, starting with https://'],
  uuid: [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Enter a valid UUID.'],
  date: [/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD.'],
  'date-time': [/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/, 'Enter a date and time.'],
  ipv4: [/^(\d{1,3}\.){3}\d{1,3}$/, 'Enter a valid IPv4 address.'],
};

const typeName = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

/**
 * Validate `value` against `schema`. Returns a map { "body.address.city": "message" }.
 * `required` says whether the field itself must be present.
 */
export function validateValue(schema, value, root, { path = 'value', required = false, depth = 0, ancestors = [] } = {}) {
  const errors = {};
  const { schema: s, refs, recursive, error } = resolveSchema(schema, root, ancestors);
  if (error) return errors;
  const open = [...ancestors, ...refs];

  if (isEmpty(value)) {
    if (!required) return errors;
    // A required object: point at the missing fields inside it rather than at the whole group.
    if (s.type === 'object' && isObject(s.properties) && (s.required ?? []).length && depth <= MAX_DEPTH && !recursive) {
      return validateProperties(s, {}, root, { path, depth, open });
    }
    errors[path] = Array.isArray(value) ? 'Add at least one item.' : 'This field is required.';
    return errors;
  }
  if (depth > MAX_DEPTH || recursive) return errors;

  if (Array.isArray(s.enum) && s.type !== 'array' && !s.enum.some((e) => e === value || String(e) === String(value))) {
    errors[path] = `Choose one of: ${s.enum.map(enumLabel).join(', ')}.`;
    return errors;
  }

  switch (s.type) {
    case 'integer':
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (typeof value === 'string' && value.trim() === '') break;
      if (!Number.isFinite(n)) {
        errors[path] = 'Enter a number.';
        break;
      }
      if (s.type === 'integer' && !Number.isInteger(n)) errors[path] = 'Enter a whole number.';
      else if (typeof s.minimum === 'number' && (s.exclusiveMinimum === true ? n <= s.minimum : n < s.minimum))
        errors[path] = `Must be ${s.exclusiveMinimum === true ? 'more than' : 'at least'} ${s.minimum}.`;
      else if (typeof s.exclusiveMinimum === 'number' && n <= s.exclusiveMinimum) errors[path] = `Must be more than ${s.exclusiveMinimum}.`;
      else if (typeof s.maximum === 'number' && (s.exclusiveMaximum === true ? n >= s.maximum : n > s.maximum))
        errors[path] = `Must be ${s.exclusiveMaximum === true ? 'less than' : 'at most'} ${s.maximum}.`;
      else if (typeof s.exclusiveMaximum === 'number' && n >= s.exclusiveMaximum) errors[path] = `Must be less than ${s.exclusiveMaximum}.`;
      else if (typeof s.multipleOf === 'number' && Math.abs(n / s.multipleOf - Math.round(n / s.multipleOf)) > 1e-9)
        errors[path] = `Must be a multiple of ${s.multipleOf}.`;
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') errors[path] = 'Choose yes or no.';
      break;
    case 'string': {
      if (s.format === 'binary') break;
      if (typeof value !== 'string') {
        errors[path] = 'Enter text.';
        break;
      }
      if (typeof s.minLength === 'number' && value.length < s.minLength) errors[path] = `Use at least ${s.minLength} characters.`;
      else if (typeof s.maxLength === 'number' && value.length > s.maxLength) errors[path] = `Use at most ${s.maxLength} characters.`;
      else if (s.pattern) {
        let re = null;
        try {
          re = new RegExp(s.pattern, 'u');
        } catch {
          re = null;
        }
        if (re && !re.test(value)) errors[path] = `Doesn't match the expected format (${s.pattern}).`;
      }
      if (!errors[path] && FORMAT_CHECKS[s.format] && !FORMAT_CHECKS[s.format][0].test(value)) errors[path] = FORMAT_CHECKS[s.format][1];
      break;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors[path] = 'Expected a list.';
        break;
      }
      if (typeof s.minItems === 'number' && value.length < s.minItems) errors[path] = `Needs at least ${s.minItems} item(s).`;
      else if (typeof s.maxItems === 'number' && value.length > s.maxItems) errors[path] = `Allows at most ${s.maxItems} item(s).`;
      else if (s.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errors[path] = 'Items must be unique.';
      value.forEach((item, i) =>
        Object.assign(errors, validateValue(s.items ?? {}, item, root, { path: `${path}[${i}]`, required: true, depth: depth + 1, ancestors: open })),
      );
      break;
    }
    case 'object': {
      if (!isObject(value)) {
        errors[path] = `Expected an object, got ${typeName(value)}.`;
        break;
      }
      Object.assign(errors, validateProperties(s, value, root, { path, depth, open }));
      if (s.additionalProperties === false) {
        const extra = Object.keys(value).filter((k) => !(k in (s.properties ?? {})));
        if (extra.length) errors[path] = `Unknown field${extra.length > 1 ? 's' : ''}: ${extra.join(', ')}.`;
      }
      break;
    }
    default:
      break;
  }
  return errors;
}

function validateProperties(s, value, root, { path, depth, open }) {
  const errors = {};
  const req = new Set(Array.isArray(s.required) ? s.required : []);
  for (const [k, child] of Object.entries(s.properties ?? {})) {
    if (resolveSchema(child, root, open).schema.readOnly) continue;
    Object.assign(
      errors,
      validateValue(child, value[k], root, { path: `${path}.${k}`, required: req.has(k), depth: depth + 1, ancestors: open }),
    );
  }
  return errors;
}

/** Convert a form string to the schema's primitive type ("12" → 12, "true" → true). */
export function coerceValue(schema, value, root) {
  const { schema: s } = resolveSchema(schema, root);
  if (value === '' || value === undefined || value === null) return undefined;
  if ((s.type === 'integer' || s.type === 'number') && typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (s.type === 'boolean' && typeof value === 'string') return value === 'true';
  return value;
}

function structuredCloneSafe(v) {
  try {
    return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
  } catch {
    return v;
  }
}
