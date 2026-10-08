/**
 * Picks where projects, YAML files and settings are stored:
 *   - normal build: the Express API + MongoDB (restSource)
 *   - browser-only build (VITE_DEMO): the hosted artifact's database when the
 *     page runs inside Claude, otherwise memory.
 */
import { createRestSource } from './restSource.js';
import { createLocalSource, createMemorySource } from './localSource.js';
import { createArtifactSettingsRepo, createArtifactStore } from './artifactStore.js';

export const BROWSER_ONLY = import.meta.env?.VITE_DEMO === 'true';

// Documents in the artifact database are capped at 256 KiB.
const ARTIFACT_MAX_KB = 200;

export async function resolveDataSource() {
  if (!BROWSER_ONLY) return createRestSource();

  const use = typeof window !== 'undefined' ? window.claude?.use : undefined;
  if (typeof use === 'function') {
    let db = null;
    try {
      db = await window.claude.use('db');
    } catch {
      db = null;
    }
    if (db) {
      return createLocalSource({
        store: createArtifactStore(db),
        settingsRepo: createArtifactSettingsRepo(db),
        kind: 'artifact',
        label: 'Shared workspace database',
        maxFileSizeKb: ARTIFACT_MAX_KB,
        note: 'Projects and YAML files are saved in this workspace’s database. API requests are sent from your browser.',
      });
    }
  }
  return createMemorySource();
}
