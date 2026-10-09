/**
 * Backend for the browser-only build (no server): settings are kept in this
 * browser and API requests are sent from the browser. Credentials stay in
 * this tab (sessionStorage) and are forgotten when it closes.
 */
import { sanitizeSettings, withDefaults } from '@workbench/shared/settings';
import { createLocalSecrets } from './localSecrets.js';
import { executeInBrowser } from './browserExecute.js';
import { ApiError } from './errors.js';

const SETTINGS_KEY = 'ppiwb.settings';

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
  const local = createLocalSecrets();
  const publicSettings = () => local.flags(withDefaults(memorySettings));

  return {
    kind: 'browser',
    supportsProxy: false,

    settings: {
      get: async () => publicSettings(),
      save: async (input, secretUpdates = {}) => {
        let next;
        try {
          next = sanitizeSettings({ ...input, request: { ...input?.request, sendVia: 'browser' } }, publicSettings());
        } catch (err) {
          throw new ApiError('SETTINGS_INVALID', err.message, { fields: err.fields });
        }
        local.apply(secretUpdates);
        const { tokenSet: _a, passwordSet: _b, apiKeyValueSet: _c, ...auth } = next.auth;
        memorySettings = { ...next, auth };
        if (globalThis.localStorage) write(localStorage, SETTINGS_KEY, memorySettings);
        return publicSettings();
      },
    },

    samples: async () => (await import('./demoSamples.js')).default,

    /** Credentials for requests sent from this browser (Swagger UI view, browser mode). */
    browserAuth: (settings) => ({ ...settings.auth, ...local.get() }),

    /** The browser sends the request itself; credentials come from this tab's session. */
    async execute({ req, files = {}, settings, signal, rebuild }) {
      const withAuth = rebuild ? rebuild({ ...settings.auth, ...local.get() }) : req;
      return executeInBrowser(withAuth, { timeoutMs: settings?.request?.timeoutMs, files, signal });
    },
  };
}
