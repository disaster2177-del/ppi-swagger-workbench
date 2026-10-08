import { MESSAGES } from '@workbench/shared/openapi';

/** Error with a code and a message that is safe to show. */
export class ApiError extends Error {
  constructor(code, message, { status, details, fields } = {}) {
    super(message || MESSAGES[code] || MESSAGES.GENERIC);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.fields = fields;
  }
}

/** Normalise anything thrown into { code, message, details } for the UI. */
export function toUserError(err, fallbackCode = 'GENERIC') {
  if (!err) return { code: fallbackCode, message: MESSAGES[fallbackCode] ?? MESSAGES.GENERIC };
  if (err.name === 'ApiError' || err.name === 'AppError') return { code: err.code, message: err.message, details: err.details, fields: err.fields };
  if (err.name === 'SettingsValidationError' || err.code === 'SETTINGS_INVALID') return { code: 'SETTINGS_INVALID', message: err.message, fields: err.fields };
  if (err.name === 'AbortError') return { code: 'CANCELLED', message: MESSAGES.CANCELLED };
  // Raw errors (TypeError etc.) are not shown verbatim; keep them as technical details.
  return { code: fallbackCode, message: MESSAGES[fallbackCode] ?? MESSAGES.GENERIC, details: err.message };
}

/** Human summary of upload details (line/column or validation problems). */
export function describeDetails(details) {
  if (!details) return undefined;
  if (typeof details === 'string') return details;
  if (details.line) return `Line ${details.line}${details.column ? `, column ${details.column}` : ''}: ${details.reason ?? ''}`.trim();
  if (Array.isArray(details.problems))
    return details.problems.map((p) => `${p.path ? `${p.path}: ` : ''}${p.message}`).join('\n') + (details.count > details.problems.length ? `\n…and ${details.count - details.problems.length} more` : '');
  if (details.reason) return details.reason;
  return JSON.stringify(details, null, 2);
}
