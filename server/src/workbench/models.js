import mongoose from 'mongoose';

/**
 * Shared application settings (one document, _id "app").
 * Secrets are stored AES-256-GCM encrypted, never in `data`.
 *
 * Projects and YAML files are not stored on the server; they live in each
 * user's browser (see client/src/services/dataSource.js).
 */
const settingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'app' },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    secrets: {
      token: { type: String, default: null },
      password: { type: String, default: null },
      apiKeyValue: { type: String, default: null },
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false, collection: 'app_settings', minimize: false },
);

export const AppSettings = mongoose.models.AppSettings ?? mongoose.model('AppSettings', settingsSchema);
