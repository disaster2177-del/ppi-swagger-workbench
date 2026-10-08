import mongoose from 'mongoose';

/**
 * Workbench data model:
 *
 *   Project 1 ── * YamlFile 1 ── * Endpoint
 *
 * YamlFile.project and Endpoint.project / Endpoint.yamlFile are ObjectId
 * references. Deleting goes top-down in WorkbenchService so no orphans remain.
 */
const { Schema } = mongoose;
const CASE_INSENSITIVE = { locale: 'en', strength: 2 };

const projectSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true },
    description: { type: String, default: '', maxlength: 500 },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { versionKey: false, collection: 'projects' },
);
projectSchema.index({ name: 1 }, { unique: true, collation: CASE_INSENSITIVE });

const yamlFileSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    fileName: { type: String, required: true },
    filePath: { type: String, required: true },
    content: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    format: { type: String, enum: ['openapi', 'swagger', 'yaml'], required: true },
    specVersion: { type: String, default: '' },
    title: { type: String, default: '' },
    apiVersion: { type: String, default: '' },
    endpointCount: { type: Number, default: 0 },
    warnings: { type: [{ path: String, message: String, _id: false }], default: [] },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { versionKey: false, collection: 'yaml_files' },
);
yamlFileSchema.index({ project: 1, fileName: 1 }, { unique: true });

const endpointSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    yamlFile: { type: Schema.Types.ObjectId, ref: 'YamlFile', required: true, index: true },
    key: { type: String, required: true },
    method: { type: String, required: true },
    path: { type: String, required: true },
    operationId: { type: String, default: '' },
    summary: { type: String, default: '' },
    description: { type: String, default: '' },
    tags: { type: [String], default: [] },
    deprecated: { type: Boolean, default: false },
    createdAt: { type: Date, required: true },
  },
  { versionKey: false, collection: 'endpoints' },
);
endpointSchema.index({ yamlFile: 1, method: 1, path: 1 }, { unique: true });

/** One document (_id "app"). Secrets are stored AES-256-GCM encrypted, never in `data`. */
const settingsSchema = new Schema(
  {
    _id: { type: String, default: 'app' },
    data: { type: Schema.Types.Mixed, default: {} },
    secrets: {
      token: { type: String, default: null },
      password: { type: String, default: null },
      apiKeyValue: { type: String, default: null },
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false, collection: 'app_settings', minimize: false },
);

export const Project = mongoose.models.Project ?? mongoose.model('Project', projectSchema);
export const YamlFile = mongoose.models.YamlFile ?? mongoose.model('YamlFile', yamlFileSchema);
export const Endpoint = mongoose.models.Endpoint ?? mongoose.model('Endpoint', endpointSchema);
export const AppSettings = mongoose.models.AppSettings ?? mongoose.model('AppSettings', settingsSchema);
