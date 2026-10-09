/**
 * WorkbenchService store kept in the browser's localStorage, so every
 * browser (PC, profile) has its own projects and YAML files. Nothing here
 * reaches the server.
 *
 * Keys (prefix "ppiwb.v1."):
 *   projects                JSON array of projects
 *   yamlFiles               JSON array of YAML file records, without content
 *   yaml.<yamlFileId>       the YAML text
 *   endpoints.<yamlFileId>  JSON array of the file's endpoints
 *
 * `storage` is anything with getItem / setItem / removeItem / key / length
 * (window.localStorage in the browser, a fake in tests).
 */
import { AppError } from '../openapi/errors.js';

export const STORAGE_PREFIX = 'ppiwb.v1.';
const K = {
  projects: `${STORAGE_PREFIX}projects`,
  yamlFiles: `${STORAGE_PREFIX}yamlFiles`,
  yaml: (id) => `${STORAGE_PREFIX}yaml.${id}`,
  endpoints: (id) => `${STORAGE_PREFIX}endpoints.${id}`,
};

function isQuotaError(err) {
  return !!err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014);
}

const STORAGE_FULL_MESSAGE =
  "This browser's storage is full, so the file was not saved. Delete YAML files you no longer need, or export the workspace and start a new one.";

export function createLocalStorageStore(storage, { idPrefix = '' } = {}) {
  let seq = 0;
  const newId = (p) => `${p}_${idPrefix}${Date.now().toString(36)}${(seq += 1).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const readJson = (key, fallback) => {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    } catch (err) {
      if (isQuotaError(err)) throw new AppError('STORAGE_FULL', STORAGE_FULL_MESSAGE, { status: 507 });
      throw new AppError('STORAGE_UNAVAILABLE', "This browser doesn't allow saving data for this site (private window or blocked storage).", { status: 500 });
    }
  };
  const remove = (key) => {
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
  };
  const clone = (v) => (v ? JSON.parse(JSON.stringify(v)) : v);

  const projects = () => readJson(K.projects, []);
  const files = () => readJson(K.yamlFiles, []);

  return {
    kind: 'localStorage',

    projects: {
      async list() {
        return projects();
      },
      async get(id) {
        return clone(projects().find((p) => p.id === id)) ?? null;
      },
      async findByName(name) {
        const n = name.toLowerCase();
        return clone(projects().find((p) => p.name.toLowerCase() === n)) ?? null;
      },
      async create(data) {
        const rec = { ...clone(data), id: newId('prj') };
        write(K.projects, [...projects(), rec]);
        return clone(rec);
      },
      async update(id, patch) {
        const list = projects();
        const i = list.findIndex((p) => p.id === id);
        if (i < 0) return null;
        list[i] = { ...list[i], ...clone(patch), id };
        write(K.projects, list);
        return clone(list[i]);
      },
      async remove(id) {
        write(
          K.projects,
          projects().filter((p) => p.id !== id),
        );
      },
    },

    yamlFiles: {
      async listByProject(projectId) {
        return files().filter((f) => f.projectId === projectId);
      },
      async get(id) {
        const meta = files().find((f) => f.id === id);
        if (!meta) return null;
        return { ...meta, content: storage.getItem(K.yaml(id)) ?? '' };
      },
      async findByName(projectId, fileName) {
        return clone(files().find((f) => f.projectId === projectId && f.fileName === fileName)) ?? null;
      },
      async create(rec) {
        const { content, ...meta } = clone(rec);
        const id = newId('yml');
        write(K.yaml(id), content ?? '');
        try {
          write(K.yamlFiles, [...files(), { ...meta, id }]);
        } catch (err) {
          remove(K.yaml(id));
          throw err;
        }
        return { ...meta, id };
      },
      async update(id, patch) {
        const { content, ...meta } = clone(patch);
        const list = files();
        const i = list.findIndex((f) => f.id === id);
        if (i < 0) return null;
        const previous = storage.getItem(K.yaml(id));
        if (content !== undefined) write(K.yaml(id), content);
        list[i] = { ...list[i], ...meta, id };
        try {
          write(K.yamlFiles, list);
        } catch (err) {
          if (content !== undefined && previous !== null) write(K.yaml(id), previous);
          throw err;
        }
        return clone(list[i]);
      },
      async remove(id) {
        remove(K.yaml(id));
        write(
          K.yamlFiles,
          files().filter((f) => f.id !== id),
        );
      },
      async removeByProject(projectId) {
        const keep = [];
        for (const f of files()) {
          if (f.projectId === projectId) remove(K.yaml(f.id));
          else keep.push(f);
        }
        write(K.yamlFiles, keep);
      },
      async countByProject() {
        const out = {};
        for (const f of files()) {
          out[f.projectId] ??= { files: 0, endpoints: 0 };
          out[f.projectId].files += 1;
          out[f.projectId].endpoints += f.endpointCount ?? 0;
        }
        return out;
      },
    },

    endpoints: {
      async listByYamlFile(yamlFileId) {
        const meta = files().find((f) => f.id === yamlFileId);
        return readJson(K.endpoints(yamlFileId), []).map((e, i) => ({ ...e, id: `${yamlFileId}:${i}`, yamlFileId, projectId: meta?.projectId }));
      },
      async replaceForYamlFile(yamlFileId, _projectId, endpoints) {
        write(K.endpoints(yamlFileId), endpoints);
      },
      async removeByYamlFile(yamlFileId) {
        remove(K.endpoints(yamlFileId));
      },
      async removeByProject(projectId) {
        for (const f of files()) if (f.projectId === projectId) remove(K.endpoints(f.id));
      },
    },
  };
}

/** Bytes this workspace uses in the given storage (UTF-16, as browsers count it). */
export function workspaceUsage(storage) {
  let chars = 0;
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) chars += key.length + (storage.getItem(key)?.length ?? 0);
    }
  } catch {
    /* ignore */
  }
  return chars * 2;
}

/** Everything in the workspace as one JSON-able object (for export / backup). */
export function exportWorkspace(storage) {
  const data = {};
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) data[key.slice(STORAGE_PREFIX.length)] = storage.getItem(key);
  }
  return { format: 'ppi-swagger-workbench', version: 1, exportedAt: new Date().toISOString(), data };
}

/** Replace the workspace with an export. Validates the shape first; nothing changes on failure. */
export function importWorkspace(storage, payload) {
  if (!payload || payload.format !== 'ppi-swagger-workbench' || payload.version !== 1 || typeof payload.data !== 'object') {
    throw new AppError('IMPORT_INVALID', 'This file is not a workspace export from this app.');
  }
  const entries = Object.entries(payload.data);
  if (!entries.every(([k, v]) => /^(projects|yamlFiles|yaml\.[\w-]+|endpoints\.[\w-]+)$/.test(k) && typeof v === 'string')) {
    throw new AppError('IMPORT_INVALID', 'The workspace file is damaged or from an unsupported version.');
  }
  JSON.parse(payload.data.projects ?? '[]');
  JSON.parse(payload.data.yamlFiles ?? '[]');
  const backup = exportWorkspace(storage);
  clearWorkspace(storage);
  try {
    for (const [k, v] of entries) storage.setItem(STORAGE_PREFIX + k, v);
  } catch (err) {
    clearWorkspace(storage);
    for (const [k, v] of Object.entries(backup.data)) storage.setItem(STORAGE_PREFIX + k, v);
    if (isQuotaError(err)) throw new AppError('STORAGE_FULL', "The workspace is too large for this browser's storage.");
    throw err;
  }
}

export function clearWorkspace(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  for (const k of keys) storage.removeItem(k);
}
