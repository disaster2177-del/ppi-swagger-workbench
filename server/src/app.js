import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import logger from './logger.js';
import createApiRouter from './routes/api.js';

/**
 * deps: { store, pipeline, persistence, consumer } for the PPI live picture,
 * plus `workbench` (from createWorkbench()) for projects / YAML files / settings.
 */
export function createApp(deps) {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '5mb' }));
  app.use(express.text({ limit: '5mb', type: ['text/plain', 'application/x-nmea'] }));

  if (deps.workbench) app.use('/api/workbench', deps.workbench.router);
  app.use('/api', createApiRouter(deps));

  // Serve the built React app (client/dist, made by "npm run build"; only needed again after the client code changes).
  const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else {
    logger.warn(`The web UI is not built (${clientDist} is missing). Run "npm run build" once, then restart. The API works without it.`);
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res
        .status(503)
        .type('text/plain')
        .send('The web UI is not built yet.\n\nIn the project folder run:\n\n    npm run build\n\nthen restart the server (npm start).\nDuring development use "npm run dev" and open http://localhost:5173 instead.\n');
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    logger.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
