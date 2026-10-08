/**
 * REST API for projects, YAML files, endpoints, settings and request execution.
 * Mounted at /api/workbench.
 *
 *   GET    /projects                          projects with YAML/endpoint counts
 *   POST   /projects                          { name, description }
 *   PATCH  /projects/:id                      { name?, description? }
 *   DELETE /projects/:id                      also deletes its YAML files and endpoints
 *   GET    /projects/:id/yaml-files?search=   YAML files of one project (no content)
 *   POST   /projects/:id/yaml-files           multipart, field "files" (several) → per-file results
 *   GET    /yaml-files/:id                    one YAML file with content and endpoints
 *   GET    /yaml-files/:id/endpoints
 *   DELETE /yaml-files/:id
 *   GET    /settings                          public settings (credentials show as set / not set)
 *   PUT    /settings                          { settings, secrets: { token?, password?, apiKeyValue? } }
 *   POST   /execute                           JSON request spec, or multipart with "request" + "file:<field>" parts
 */
import { Router } from 'express';
import multer from 'multer';
import { AppError, MESSAGES } from '@workbench/shared/openapi';
import { SettingsValidationError } from '@workbench/shared/settings';
import { isMongoConnected } from '../db.js';
import logger from '../logger.js';

const MAX_FILES_PER_UPLOAD = 50;
const HARD_FILE_LIMIT = 20 * 1024 * 1024; // the per-file limit from Settings is checked by the service

const decoder = new TextDecoder('utf-8', { fatal: true });
function toText(buffer) {
  try {
    return { text: decoder.decode(buffer).replace(/^﻿/, '') };
  } catch {
    return { text: '', readError: true };
  }
}

export default function createWorkbenchRouter({ workbench, settings, executor }) {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: HARD_FILE_LIMIT, files: MAX_FILES_PER_UPLOAD } });

  router.use((req, res, next) => {
    if (!isMongoConnected()) {
      return res.status(503).json({ code: 'DB_UNAVAILABLE', message: 'The database is not connected, so projects and YAML files are unavailable right now.' });
    }
    next();
  });

  // ---- projects
  router.get('/projects', async (_req, res) => res.json(await workbench.listProjects()));
  router.post('/projects', async (req, res) => res.status(201).json(await workbench.createProject(req.body ?? {})));
  router.patch('/projects/:id', async (req, res) => res.json(await workbench.updateProject(req.params.id, req.body ?? {})));
  router.delete('/projects/:id', async (req, res) => res.json(await workbench.deleteProject(req.params.id)));

  // ---- YAML files
  router.get('/projects/:id/yaml-files', async (req, res) => {
    res.json(await workbench.listYamlFiles(req.params.id, { search: String(req.query.search ?? '') }));
  });

  router.post('/projects/:id/yaml-files', upload.array('files', MAX_FILES_PER_UPLOAD), async (req, res) => {
    const files = (req.files ?? []).map((f) => ({ fileName: f.originalname, sizeBytes: f.size, ...toText(f.buffer) }));
    const result = await workbench.uploadYamlFiles(req.params.id, files, await settings.getPublic());
    logger.info(`YAML upload to project ${req.params.id}: ${result.succeeded} stored, ${result.failed} rejected`);
    res.status(result.succeeded ? 201 : 422).json(result);
  });

  router.get('/yaml-files/:id', async (req, res) => res.json(await workbench.getYamlFile(req.params.id)));
  router.get('/yaml-files/:id/endpoints', async (req, res) => res.json((await workbench.getYamlFile(req.params.id)).endpoints));
  router.delete('/yaml-files/:id', async (req, res) => res.json(await workbench.deleteYamlFile(req.params.id)));

  // ---- settings
  router.get('/settings', async (_req, res) => res.json(await settings.getPublic()));
  router.put('/settings', async (req, res) => {
    const { settings: input, secrets } = req.body ?? {};
    res.json(await settings.update(input ?? {}, secrets ?? {}));
  });

  // ---- execute
  router.post('/execute', upload.any(), async (req, res) => {
    let spec = req.body;
    if (typeof req.body?.request === 'string') {
      try {
        spec = JSON.parse(req.body.request);
      } catch {
        throw new AppError('REQUEST_FAILED', 'The request description is not valid JSON.');
      }
    }
    res.json(await executor.execute(spec, req.files ?? []));
  });

  // ---- errors: always a { code, message } body the UI can show as-is
  // eslint-disable-next-line no-unused-vars
  router.use((err, _req, res, _next) => {
    if (err instanceof AppError) return res.status(err.status).json(err.toJSON());
    if (err instanceof SettingsValidationError) return res.status(400).json({ code: err.code, message: err.message, fields: err.fields });
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `${MESSAGES.FILE_TOO_LARGE} The upload limit is 20 MB per file.`
          : err.code === 'LIMIT_FILE_COUNT'
            ? `Upload at most ${MAX_FILES_PER_UPLOAD} files at a time.`
            : MESSAGES.UPLOAD_FAILED;
      return res.status(400).json({ code: 'UPLOAD_FAILED', message });
    }
    if (err?.code === 11000) return res.status(409).json({ code: 'CONFLICT', message: 'That name is already in use.' });
    if (err?.name === 'CastError') return res.status(404).json({ code: 'NOT_FOUND', message: MESSAGES.NOT_FOUND });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ code: 'BAD_REQUEST', message: 'The request body is not valid JSON.' });
    logger.error(err);
    res.status(500).json({ code: 'INTERNAL', message: MESSAGES.GENERIC });
  });

  return router;
}
