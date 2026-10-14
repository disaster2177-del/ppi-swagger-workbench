/**
 * Development only (npm run dev): serve the React UI straight from client/src
 * through Vite, on the same port as the API. No "npm run build" needed:
 * saving a client file updates the open browser (hot reload).
 *
 * Production (npm start) never loads this; it serves the built client/dist.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from './logger.js';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client');

export async function createDevUi(httpServer) {
  let createServer;
  try {
    ({ createServer } = await import('vite'));
  } catch {
    throw new Error('Live UI needs the development packages (vite). Run "npm install" in the project folder, or use "npm start" with a built UI.');
  }
  // Tells client/vite.config.js not to set up its own proxy: here the API is in the same server.
  process.env.VITE_MIDDLEWARE = '1';
  const vite = await createServer({
    root: clientDir,
    configFile: path.join(clientDir, 'vite.config.js'),
    appType: 'spa',
    // Hot reload shares the server's port (Socket.IO on /socket.io is not affected).
    server: { middlewareMode: true, hmr: { server: httpServer } },
  });
  logger.info('Live UI: served from client/src with hot reload - no "npm run build" needed while developing');
  return vite;
}
