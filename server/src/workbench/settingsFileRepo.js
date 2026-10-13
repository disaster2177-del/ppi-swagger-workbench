import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '@workbench/shared/openapi';

/**
 * Without MongoDB: the same settings in one JSON file (secrets stay encrypted).
 * Written to a temporary file first and renamed, so a crash never leaves half a file.
 */
export function createFileSettingsRepo(file) {
  return {
    describe: () => file,
    async load() {
      try {
        const doc = JSON.parse(await fs.promises.readFile(file, 'utf8'));
        return { data: doc?.data ?? {}, secrets: doc?.secrets ?? {} };
      } catch (err) {
        if (err.code === 'ENOENT') return { data: {}, secrets: {} };
        throw new AppError('SETTINGS_FILE', `Settings file ${file} could not be read: ${err.message}`, { status: 500 });
      }
    },
    async save({ data, secrets }) {
      try {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.promises.writeFile(tmp, JSON.stringify({ data, secrets, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
        await fs.promises.rename(tmp, file);
      } catch (err) {
        throw new AppError('SETTINGS_FILE', `Settings could not be saved to ${file}: ${err.message}`, { status: 500 });
      }
    },
  };
}
