/**
 * Workbench REST API, mounted at /api/workbench.
 *
 * Projects and YAML files are NOT stored on the server: each user's
 * workspace lives in their own browser (localStorage). The server only
 * provides shared settings, the request proxy and test helpers.
 *
 *   GET  /settings          public settings (credentials show as set / not set)
 *   PUT  /settings          { settings, secrets: { token?, password?, apiKeyValue? } }
 *   POST /execute           JSON request spec, or multipart with "request" + "file:<field>" parts
 *   GET  /samples           example projects and YAML files (read-only, for "Load examples")
 *   ANY  /echo/...          echoes the request back: a target for testing Base URL + Base Path
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import { AppError, MESSAGES } from '@workbench/shared/openapi';
import { SettingsValidationError } from '@workbench/shared/settings';
import logger from '../logger.js';

const SAMPLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../samples/openapi');
const MASK = /^(authorization|cookie|x-api-key|proxy-authorization)$/i;

function loadSamples() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, 'projects.json'), 'utf8'));
    return Object.entries(manifest.projects ?? {}).map(([folder, info]) => ({
      name: info.name,
      description: info.description ?? '',
      files: fs
        .readdirSync(path.join(SAMPLES_DIR, folder))
        .filter((f) => /\.ya?ml$/i.test(f))
        .sort()
        .map((f) => ({ fileName: f, text: fs.readFileSync(path.join(SAMPLES_DIR, folder, f), 'utf8') })),
    }));
  } catch (err) {
    logger.warn(`Example YAML files not available: ${err.message}`);
    return [];
  }
}

export default function createWorkbenchRouter({ settings, executor }) {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 20 } });

  router.get('/settings', async (_req, res) => res.json(await settings.getPublic()));
  router.put('/settings', async (req, res) => {
    const { settings: input, secrets } = req.body ?? {};
    res.json(await settings.update(input ?? {}, secrets ?? {}));
  });

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

  router.get('/samples', (_req, res) => res.json(loadSamples()));

  // Test target: set Base URL to http://<host>:4000/api/workbench/echo to see exactly what the proxy sends.
  router.use('/echo', (req, res) => {
    res.json({
      echo: true,
      method: req.method,
      path: req.path,
      query: req.query,
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, MASK.test(k) ? '••••••' : v])),
      body: req.body ?? null,
      receivedAt: new Date().toISOString(),
    });
  });

  // ---- errors: always a { code, message } body the UI can show as-is
  // eslint-disable-next-line no-unused-vars
  router.use((err, _req, res, _next) => {
    if (err instanceof AppError) return res.status(err.status).json(err.toJSON());
    if (err instanceof SettingsValidationError) return res.status(400).json({ code: err.code, message: err.message, fields: err.fields });
    if (err instanceof multer.MulterError) return res.status(400).json({ code: 'UPLOAD_FAILED', message: MESSAGES.UPLOAD_FAILED });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ code: 'BAD_REQUEST', message: 'The request body is not valid JSON.' });
    logger.error(err);
    res.status(500).json({ code: 'INTERNAL', message: MESSAGES.GENERIC });
  });

  return router;
}
