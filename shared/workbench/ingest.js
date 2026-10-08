/**
 * YAML upload pipeline for one file:
 *   1. check the file type    2. check the size     3. parse the YAML
 *   4. validate OpenAPI/Swagger   5. extract the endpoints
 * Throws AppError on the first failing step, with a plain-language message
 * and the technical detail in `details`.
 */
import { AppError, MESSAGES } from '../openapi/errors.js';
import { parseDefinitionText } from '../openapi/parse.js';
import { validateDefinition } from '../openapi/validate.js';
import { buildApiModel, extractEndpoints } from '../openapi/model.js';

export function fileExtension(name = '') {
  const m = /(\.[^./\\]+)$/.exec(name.toLowerCase());
  return m ? m[1] : '';
}

/** Byte length of a string as UTF-8, without needing Buffer or TextEncoder. */
export function utf8Length(text) {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i += 1;
    } else n += 3;
  }
  return n;
}

/** Strip directories and characters that are unsafe in a stored file name. */
export function safeFileName(name = '') {
  const base = String(name).split(/[\\/]/).pop().trim();
  return base.replace(/[^\w.\- ()]+/g, '_').slice(0, 200) || 'untitled.yaml';
}

export function processYamlFile({ fileName, text, sizeBytes }, validation) {
  const name = safeFileName(fileName);
  const ext = fileExtension(name);
  const allowed = validation.allowedExtensions ?? ['.yaml', '.yml'];
  if (!allowed.includes(ext)) {
    throw new AppError('UNSUPPORTED_TYPE', `Unsupported file type "${ext || 'none'}". Upload ${allowed.join(' or ')} files.`);
  }

  const size = sizeBytes ?? utf8Length(text ?? '');
  const maxBytes = (validation.maxFileSizeKb ?? 1024) * 1024;
  if (size > maxBytes) {
    throw new AppError('FILE_TOO_LARGE', `${MESSAGES.FILE_TOO_LARGE} The limit is ${formatKb(validation.maxFileSizeKb)}.`, { status: 413 });
  }

  const definition = parseDefinitionText(text);

  const report = validateDefinition(definition, { mode: validation.mode ?? 'standard' });
  if (!report.valid) {
    throw new AppError('INVALID_OPENAPI', undefined, { details: { problems: report.errors, count: report.errorCount } });
  }

  const model = buildApiModel(definition);
  const endpoints = extractEndpoints(model);
  return {
    fileName: name,
    sizeBytes: size,
    format: model.format ?? 'yaml',
    specVersion: model.specVersion,
    title: model.title,
    apiVersion: String(model.version ?? ''),
    endpoints,
    warnings: report.warnings,
  };
}

function formatKb(kb) {
  return kb >= 1024 ? `${Math.round((kb / 1024) * 10) / 10} MB` : `${kb} KB`;
}
