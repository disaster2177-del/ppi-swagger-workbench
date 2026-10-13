import path from 'node:path';
import config from '../config.js';
import { SettingsService } from './settingsService.js';
import { createMongoSettingsRepo } from './settingsRepo.js';
import { createFileSettingsRepo } from './settingsFileRepo.js';
import { ExecuteService } from './executeService.js';
import createWorkbenchRouter from './routes.js';

/**
 * Shared settings + request proxy. Projects and YAML files live in each user's browser.
 * Settings are kept in MongoDB, or in DATA_DIR/settings.json when MONGO_URI is empty.
 */
export function createWorkbench() {
  const repo = config.mongo.enabled ? createMongoSettingsRepo() : createFileSettingsRepo(path.join(config.dataDir, 'settings.json'));
  const settings = new SettingsService(repo);
  const executor = new ExecuteService({ settings });
  return { settings, executor, settingsStore: repo.describe(), router: createWorkbenchRouter({ settings, executor }) };
}
