/**
 * Application settings: defaults, and sanitising of anything a client sends.
 *
 * Secrets (bearer token, password, API key value) are never part of the
 * public settings object. The server stores them encrypted and only reports
 * whether each one is set; see server/src/workbench/services/settingsService.js.
 */

export const VIEW_MODES = ['ppi', 'split', 'swagger'];
export const THEMES = ['system', 'light', 'dark'];
export const AUTH_TYPES = ['none', 'bearer', 'basic', 'apiKey'];
export const VALIDATION_MODES = ['strict', 'standard', 'lenient'];
export const DUPLICATE_POLICIES = ['replace', 'rename', 'reject'];
export const SECRET_FIELDS = ['token', 'password', 'apiKeyValue'];

export const DEFAULT_SETTINGS = Object.freeze({
  environments: [{ id: 'env-default', name: 'Default', baseUrl: '', basePath: '' }],
  activeEnvironmentId: 'env-default',
  request: {
    timeoutMs: 30000,
    defaultHeaders: [],
    useServerProxy: true,
  },
  auth: {
    type: 'none',
    username: '',
    apiKeyName: 'X-API-Key',
    apiKeyIn: 'header',
    // set flags only; secret values never leave the server
    tokenSet: false,
    passwordSet: false,
    apiKeyValueSet: false,
  },
  defaults: {
    projectId: '',
    viewMode: 'split',
    theme: 'system',
  },
  validation: {
    mode: 'standard',
    maxFileSizeKb: 1024,
    allowedExtensions: ['.yaml', '.yml'],
    duplicatePolicy: 'replace',
  },
});

const str = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
const int = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

export class SettingsValidationError extends Error {
  constructor(fields) {
    super('Some settings are not valid. Check the highlighted fields.');
    this.code = 'SETTINGS_INVALID';
    this.fields = fields;
  }
}

/** Accepts "", "https://host", "https://host/prefix", or a relative "/prefix". */
export function checkBaseUrl(value) {
  const v = value.trim();
  if (!v) return null;
  if (v.startsWith('/')) return null;
  try {
    const u = new URL(v);
    if (!/^https?:$/.test(u.protocol)) return 'Use an http:// or https:// address.';
    if (u.search || u.hash) return 'Leave out "?" and "#" parts. Put the path in Base Path.';
    return null;
  } catch {
    return 'Enter a full address such as https://api.example.com';
  }
}

export function checkBasePath(value) {
  const v = value.trim();
  if (!v) return null;
  if (!v.startsWith('/')) return 'Start the base path with "/", for example /api/v1';
  if (/[?#\s]/.test(v)) return 'The base path cannot contain spaces, "?" or "#".';
  return null;
}

/**
 * Whitelist and type-check settings coming from a client. Unknown keys are dropped.
 * Throws SettingsValidationError with a { field: message } map when something is invalid.
 */
export function sanitizeSettings(input = {}, current = DEFAULT_SETTINGS) {
  const fields = {};
  const src = input && typeof input === 'object' ? input : {};

  const envInput = Array.isArray(src.environments) ? src.environments : current.environments;
  const environments = envInput.slice(0, 20).map((e, i) => {
    const env = {
      id: str(e?.id, 64) || `env-${i + 1}`,
      name: str(e?.name, 60).trim() || `Environment ${i + 1}`,
      baseUrl: str(e?.baseUrl, 500).trim(),
      basePath: str(e?.basePath, 300).trim(),
    };
    const u = checkBaseUrl(env.baseUrl);
    if (u) fields[`environments.${i}.baseUrl`] = u;
    const p = checkBasePath(env.basePath);
    if (p) fields[`environments.${i}.basePath`] = p;
    return env;
  });
  if (!environments.length) environments.push({ ...DEFAULT_SETTINGS.environments[0] });
  const activeEnvironmentId = environments.some((e) => e.id === src.activeEnvironmentId)
    ? src.activeEnvironmentId
    : environments.some((e) => e.id === current.activeEnvironmentId)
      ? current.activeEnvironmentId
      : environments[0].id;

  const r = { ...current.request, ...(src.request ?? {}) };
  const defaultHeaders = (Array.isArray(r.defaultHeaders) ? r.defaultHeaders : []).slice(0, 30).map((h, i) => {
    const name = str(h?.name, 100).trim();
    const value = str(h?.value, 2000);
    if (name && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) fields[`request.defaultHeaders.${i}.name`] = 'Header names can use letters, digits and - only.';
    if (/[\r\n]/.test(value)) fields[`request.defaultHeaders.${i}.value`] = 'Header values must be a single line.';
    return { name, value, enabled: h?.enabled !== false };
  });
  const request = {
    timeoutMs: int(r.timeoutMs, 1000, 300000, DEFAULT_SETTINGS.request.timeoutMs),
    defaultHeaders: defaultHeaders.filter((h) => h.name),
    useServerProxy: r.useServerProxy !== false,
  };

  const a = { ...current.auth, ...(src.auth ?? {}) };
  const auth = {
    type: pick(a.type, AUTH_TYPES, 'none'),
    username: str(a.username, 200),
    apiKeyName: str(a.apiKeyName, 100).trim() || 'X-API-Key',
    apiKeyIn: pick(a.apiKeyIn, ['header', 'query'], 'header'),
    tokenSet: !!current.auth?.tokenSet,
    passwordSet: !!current.auth?.passwordSet,
    apiKeyValueSet: !!current.auth?.apiKeyValueSet,
  };
  if (auth.type === 'apiKey' && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(auth.apiKeyName)) fields['auth.apiKeyName'] = 'Use letters, digits and - only.';

  const d = { ...current.defaults, ...(src.defaults ?? {}) };
  const defaults = {
    projectId: str(d.projectId, 64),
    viewMode: pick(d.viewMode, VIEW_MODES, 'split'),
    theme: pick(d.theme, THEMES, 'system'),
  };

  const v = { ...current.validation, ...(src.validation ?? {}) };
  const allowedExtensions = (Array.isArray(v.allowedExtensions) ? v.allowedExtensions : ['.yaml', '.yml'])
    .map((x) => str(x, 10).trim().toLowerCase())
    .filter(Boolean)
    .map((x) => (x.startsWith('.') ? x : `.${x}`))
    .filter((x) => /^\.[a-z0-9]+$/.test(x));
  if (!allowedExtensions.length) fields['validation.allowedExtensions'] = 'Allow at least one file extension.';
  const validation = {
    mode: pick(v.mode, VALIDATION_MODES, 'standard'),
    maxFileSizeKb: int(v.maxFileSizeKb, 1, 20480, 1024),
    allowedExtensions: [...new Set(allowedExtensions)],
    duplicatePolicy: pick(v.duplicatePolicy, DUPLICATE_POLICIES, 'replace'),
  };

  if (Object.keys(fields).length) throw new SettingsValidationError(fields);
  return { environments, activeEnvironmentId, request, auth, defaults, validation };
}

/** The environment requests currently go to. */
export function activeEnvironment(settings) {
  return settings.environments.find((e) => e.id === settings.activeEnvironmentId) ?? settings.environments[0];
}

/** Merge stored settings over the defaults so new fields always exist. */
export function withDefaults(stored) {
  try {
    return sanitizeSettings(stored ?? {}, { ...DEFAULT_SETTINGS, ...(stored ?? {}), auth: { ...DEFAULT_SETTINGS.auth, ...(stored?.auth ?? {}) } });
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}
