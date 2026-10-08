/**
 * Data source that runs the shared WorkbenchService in the browser.
 * Used by the browser-only build: the store is the artifact's database when
 * available (artifactStore.js), otherwise memory.
 *
 * Credentials stay in this browser tab only (sessionStorage); they are never
 * written to the shared database.
 */
import { MemoryStore, WorkbenchService } from '@workbench/shared/workbench';
import { SECRET_FIELDS, sanitizeSettings, withDefaults } from '@workbench/shared/settings';
import { executeInBrowser } from './browserExecute.js';
import { ApiError } from './errors.js';

const SECRET_KEY = 'workbench.secrets';

function readSecrets() {
  try {
    return JSON.parse(sessionStorage.getItem(SECRET_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeSecrets(s) {
  try {
    sessionStorage.setItem(SECRET_KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: secrets last for this page view only */
  }
}

let memorySecrets = readSecrets();

/** Wraps service calls so AppError / SettingsValidationError reach the UI with their code. */
async function call(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err?.name === 'AppError') throw new ApiError(err.code, err.message, { status: err.status, details: err.details });
    if (err?.code === 'SETTINGS_INVALID') throw new ApiError('SETTINGS_INVALID', err.message, { fields: err.fields });
    if (err?.code === 'quota_exceeded') throw new ApiError('QUOTA', 'The database is full. Delete some YAML files or projects and try again.');
    if (err?.code === 'invalid_argument') throw new ApiError('READ_ONLY', "You can view this workspace but not change it. Ask the owner for edit access.");
    if (err?.code === 'unavailable' || err?.code === 'revoked') throw new ApiError('DB_UNAVAILABLE', 'The database is not reachable right now. Please try again.');
    throw err;
  }
}

export function createLocalSource({ store, settingsRepo, kind, label, maxFileSizeKb = Infinity, note }) {
  const service = new WorkbenchService(store);

  const publicSettings = async () => {
    const s = withDefaults(await settingsRepo.load());
    s.auth.tokenSet = !!memorySecrets.token;
    s.auth.passwordSet = !!memorySecrets.password;
    s.auth.apiKeyValueSet = !!memorySecrets.apiKeyValue;
    return s;
  };

  return {
    kind,
    label,
    note,
    supportsProxy: false,
    maxFileSizeKb,

    projects: {
      list: () => call(() => service.listProjects()),
      create: (data) => call(() => service.createProject(data)),
      update: (id, data) => call(() => service.updateProject(id, data)),
      remove: (id) => call(() => service.deleteProject(id)),
    },

    yamlFiles: {
      list: (projectId, search) => call(() => service.listYamlFiles(projectId, { search })),
      get: (id) => call(() => service.getYamlFile(id)),
      remove: (id) => call(() => service.deleteYamlFile(id)),
      upload: (projectId, files) =>
        call(async () => {
          const settings = await publicSettings();
          const validation = { ...settings.validation, maxFileSizeKb: Math.min(settings.validation.maxFileSizeKb, maxFileSizeKb) };
          const read = await Promise.all(
            files.map(async (f) => {
              try {
                return { fileName: f.name, sizeBytes: f.size, text: (await f.text()).replace(/^﻿/, '') };
              } catch {
                return { fileName: f.name, sizeBytes: f.size, text: '', readError: true };
              }
            }),
          );
          return service.uploadYamlFiles(projectId, read, { ...settings, validation });
        }),
    },

    settings: {
      get: () => call(publicSettings),
      save: (input, secrets = {}) =>
        call(async () => {
          const current = await publicSettings();
          const next = sanitizeSettings(input, current);
          for (const f of SECRET_FIELDS) {
            if (!(f in secrets)) continue;
            if (typeof secrets[f] === 'string' && secrets[f] !== '') memorySecrets[f] = secrets[f];
            else delete memorySecrets[f];
          }
          memorySecrets = { ...memorySecrets };
          writeSecrets(memorySecrets);
          const { tokenSet: _a, passwordSet: _b, apiKeyValueSet: _c, ...auth } = next.auth;
          await settingsRepo.save({ ...next, auth });
          return publicSettings();
        }),
    },

    /** The browser sends the request itself; credentials are added here from this tab's session. */
    async execute({ req, files = {}, settings, signal, rebuild }) {
      const withAuth = rebuild ? rebuild({ ...settings.auth, ...memorySecrets }) : req;
      return executeInBrowser(withAuth, { timeoutMs: settings?.request?.timeoutMs, files, signal });
    },
  };
}

export function createMemorySource() {
  let stored = {};
  return createLocalSource({
    store: new MemoryStore(),
    settingsRepo: { load: async () => stored, save: async (s) => void (stored = s) },
    kind: 'memory',
    label: 'Temporary (this page only)',
    note: 'No database is connected, so projects and YAML files are kept only until you reload the page.',
  });
}
