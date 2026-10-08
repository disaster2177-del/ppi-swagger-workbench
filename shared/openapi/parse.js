import { parseDocument } from 'yaml';
import { AppError } from './errors.js';

/**
 * Parse YAML (or JSON, which is valid YAML) text into a plain object.
 * Throws AppError INVALID_YAML / EMPTY_FILE / NOT_AN_OBJECT with the line and
 * column of the first syntax problem in `details`.
 */
export function parseDefinitionText(text) {
  if (typeof text !== 'string' || !text.trim()) throw new AppError('EMPTY_FILE');

  const doc = parseDocument(text, { uniqueKeys: true, maxAliasCount: 200, prettyErrors: true });
  if (doc.errors.length) {
    const e = doc.errors[0];
    const pos = e.linePos?.[0];
    throw new AppError('INVALID_YAML', undefined, {
      details: {
        line: pos?.line,
        column: pos?.col,
        reason: firstLine(e.message),
        errors: doc.errors.length,
      },
    });
  }

  let value;
  try {
    value = doc.toJS({ maxAliasCount: 200 });
  } catch (err) {
    throw new AppError('INVALID_YAML', undefined, { details: { reason: firstLine(err.message) } });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('NOT_AN_OBJECT');
  return value;
}

function firstLine(message = '') {
  return String(message).split('\n')[0].trim();
}
