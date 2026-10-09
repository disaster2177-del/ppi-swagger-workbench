/**
 * This browser's workspace: projects, YAML files and endpoints, kept in
 * localStorage. Every PC / browser profile has its own, and nothing is sent
 * to the server, so users on the same VM URL never see each other's files.
 * If the browser blocks storage (some private windows), the workspace lives
 * in memory for this page only and the UI says so.
 */
import {
  MemoryStore,
  STORAGE_PREFIX,
  WorkbenchService,
  clearWorkspace,
  createLocalStorageStore,
  exportWorkspace,
  importWorkspace,
  workspaceUsage,
} from '@workbench/shared/workbench';
import { ApiError } from './errors.js';

/** Approximate per-origin localStorage limit in major browsers. */
export const BROWSER_QUOTA_BYTES = 5 * 1024 * 1024;

function usableLocalStorage() {
  try {
    const s = window.localStorage;
    const probe = `${STORAGE_PREFIX}probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** Wrap service calls so AppErrors reach the UI with their code and message. */
async function call(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err?.name === 'AppError') throw new ApiError(err.code, err.message, { status: err.status, details: err.details });
    throw err;
  }
}

export function createWorkspace() {
  const storage = usableLocalStorage();
  const service = new WorkbenchService(storage ? createLocalStorageStore(storage) : new MemoryStore());

  return {
    persistent: !!storage,

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
      /** files: File objects (from an input or drop) or { fileName, text } records. */
      upload: (projectId, files, settings) =>
        call(async () => {
          const read = await Promise.all(
            files.map(async (f) => {
              if (typeof f.text === 'string') return { fileName: f.fileName, text: f.text };
              try {
                return { fileName: f.name, sizeBytes: f.size, text: (await f.text()).replace(/^﻿/, '') };
              } catch {
                return { fileName: f.name, sizeBytes: f.size, text: '', readError: true };
              }
            }),
          );
          return service.uploadYamlFiles(projectId, read, settings);
        }),
    },

    storage: {
      usageBytes: () => (storage ? workspaceUsage(storage) : 0),
      quotaBytes: BROWSER_QUOTA_BYTES,
      export: () => (storage ? exportWorkspace(storage) : null),
      import: (payload) =>
        call(async () => {
          if (!storage) throw new ApiError('STORAGE_UNAVAILABLE', "This browser doesn't allow saving data for this site.");
          importWorkspace(storage, payload);
        }),
      clear: () => storage && clearWorkspace(storage),
      /** Calls `onChange` when another tab of this browser changes the workspace. */
      subscribe: (onChange) => {
        if (!storage) return () => {};
        const handler = (e) => {
          if (!e.key || e.key.startsWith(STORAGE_PREFIX)) onChange();
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
      },
    },
  };
}
