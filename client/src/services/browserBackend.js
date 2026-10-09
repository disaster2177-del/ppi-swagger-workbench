/**
 * Backend for the browser-only build (no server): settings are kept in this
 * browser and API requests are sent from the browser. Credentials stay in
 * this tab (sessionStorage) and are forgotten when it closes.
 */
import { SECRET_FIELDS, sanitizeSettings, withDefaults } from '@workbench/shared/settings';
import { executeInBrowser } from './browserExecute.js';
import { ApiError } from './errors.js';

const SETTINGS_KEY = 'ppiwb.settings';
const SECRET_KEY = 'ppiwb.secrets';

const read = (store, key, fallback) => {
  try {
    return JSON.parse(store.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (store, key, value) => {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: keep for this page only */
  }
};

export function createBrowserBackend() {
  let memorySettings = read(globalThis.localStorage ?? { getItem: () => null }, SETTINGS_KEY, {});
  let secrets = read(globalThis.sessionStorage ?? { getItem: () => null }, SECRET_KEY, {});

  const publicSettings = () => {
    const s = withDefaults(memorySettings);
    s.auth.tokenSet = !!secrets.token;
    s.auth.passwordSet = !!secrets.password;
    s.auth.apiKeyValueSet = !!secrets.apiKeyValue;
    return s;
  };

  return {
    kind: 'browser',
    supportsProxy: false,

    settings: {
      get: async () => publicSettings(),
      save: async (input, secretUpdates = {}) => {
        let next;
        try {
          next = sanitizeSettings(input, publicSettings());
        } catch (err) {
          throw new ApiError('SETTINGS_INVALID', err.message, { fields: err.fields });
        }
        const nextSecrets = { ...secrets };
        for (const f of SECRET_FIELDS) {
          if (!(f in secretUpdates)) continue;
          if (typeof secretUpdates[f] === 'string' && secretUpdates[f] !== '') nextSecrets[f] = secretUpdates[f];
          else delete nextSecrets[f];
        }
        secrets = nextSecrets;
        if (globalThis.sessionStorage) write(sessionStorage, SECRET_KEY, secrets);
        const { tokenSet: _a, passwordSet: _b, apiKeyValueSet: _c, ...auth } = next.auth;
        memorySettings = { ...next, auth };
        if (globalThis.localStorage) write(localStorage, SETTINGS_KEY, memorySettings);
        return publicSettings();
      },
    },

    samples: async () => (await import('./demoSamples.js')).default,

    /** The browser sends the request itself; credentials come from this tab's session. */
    async execute({ req, files = {}, settings, signal, rebuild }) {
      const withAuth = rebuild ? rebuild({ ...settings.auth, ...secrets }) : req;
      return executeInBrowser(withAuth, { timeoutMs: settings?.request?.timeoutMs, files, signal });
    },
  };
}
