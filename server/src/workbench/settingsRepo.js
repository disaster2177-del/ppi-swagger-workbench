import { AppError } from '@workbench/shared/openapi';
import { isMongoConnected } from '../db.js';
import { AppSettings } from './models.js';

/**
 * Shared application settings live in one MongoDB document. When MongoDB is
 * down, reads fall back to the defaults (so API requests still work) and
 * saving reports that the database is unavailable.
 */
export function createMongoSettingsRepo() {
  return {
    async load() {
      if (!isMongoConnected()) return { data: {}, secrets: {} };
      const doc = await AppSettings.findById('app').lean();
      return { data: doc?.data ?? {}, secrets: doc?.secrets ?? {} };
    },
    async save({ data, secrets }) {
      if (!isMongoConnected()) throw new AppError('DB_UNAVAILABLE', 'Settings cannot be saved because the database is not connected.', { status: 503 });
      await AppSettings.findByIdAndUpdate('app', { data, secrets, updatedAt: new Date() }, { upsert: true, setDefaultsOnInsert: true });
    },
  };
}
