import { SettingsService } from './settingsService.js';
import { createMongoSettingsRepo } from './settingsRepo.js';
import { ExecuteService } from './executeService.js';
import createWorkbenchRouter from './routes.js';

/** Shared settings (MongoDB) + request proxy. Projects and YAML files live in each user's browser. */
export function createWorkbench() {
  const settings = new SettingsService(createMongoSettingsRepo());
  const executor = new ExecuteService({ settings });
  return { settings, executor, router: createWorkbenchRouter({ settings, executor }) };
}
