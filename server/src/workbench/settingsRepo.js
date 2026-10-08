import { AppSettings } from './models.js';

/** Settings live in one MongoDB document. */
export function createMongoSettingsRepo() {
  return {
    async load() {
      const doc = await AppSettings.findById('app').lean();
      return { data: doc?.data ?? {}, secrets: doc?.secrets ?? {} };
    },
    async save({ data, secrets }) {
      await AppSettings.findByIdAndUpdate('app', { data, secrets, updatedAt: new Date() }, { upsert: true, setDefaultsOnInsert: true });
    },
  };
}
