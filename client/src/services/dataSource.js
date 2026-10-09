/**
 * Where things live:
 *   projects, YAML files, endpoints → this browser's localStorage (workspace.js), always
 *   settings + request sending      → the server on the VM (serverBackend.js), or in the
 *                                      browser-only build (VITE_DEMO) the browser itself
 */
import { createWorkspace } from './workspace.js';
import { createServerBackend } from './serverBackend.js';
import { createBrowserBackend } from './browserBackend.js';

export const BROWSER_ONLY = import.meta.env?.VITE_DEMO === 'true';

export async function resolveDataSource() {
  const workspace = createWorkspace();
  const backend = BROWSER_ONLY ? createBrowserBackend() : createServerBackend();
  return {
    ...workspace,
    ...backend,
    label: workspace.persistent ? 'This browser only' : 'Temporary (this page only)',
    note: workspace.persistent
      ? 'Your projects and YAML files are saved in this browser. Other PCs and browsers have their own, separate workspace.'
      : "This browser doesn't allow saving data for this site (for example a private window), so your projects and YAML files are lost when you close the page.",
  };
}
