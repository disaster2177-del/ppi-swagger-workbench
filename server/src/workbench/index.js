import { WorkbenchService } from '@workbench/shared/workbench';
import { createMongoStore } from './mongoStore.js';
import { SettingsService } from './settingsService.js';
import { createMongoSettingsRepo } from './settingsRepo.js';
import { ExecuteService } from './executeService.js';
import createWorkbenchRouter from './routes.js';

/** Wire the workbench services to MongoDB. */
export function createWorkbench() {
  const workbench = new WorkbenchService(createMongoStore());
  const settings = new SettingsService(createMongoSettingsRepo());
  const executor = new ExecuteService({ workbench, settings });
  return { workbench, settings, executor, router: createWorkbenchRouter({ workbench, settings, executor }) };
}
