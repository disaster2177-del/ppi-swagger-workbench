#!/usr/bin/env node
/**
 * Checks that the npm packages a workspace needs are installed, so a missing
 * package shows one clear message instead of a long build or start error.
 *
 *   node scripts/check-install.mjs client     before "npm run build"
 *   node scripts/check-install.mjs server     before "npm start"
 *
 * Usually the fix is simply "npm install" after pulling new code
 * (package.json gained a dependency). It does not change npm or Node versions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaces = process.argv.slice(2);
const withDev = { client: true, server: false, shared: false };

/** npm puts a package in <workspace>/node_modules or, usually, the root node_modules. */
const installed = (name, wsDir) =>
  [path.join(wsDir, 'node_modules', name), path.join(root, 'node_modules', name)].some((dir) => fs.existsSync(path.join(dir, 'package.json')));

const missing = [];
for (const ws of workspaces) {
  const wsDir = path.join(root, ws);
  const pkg = JSON.parse(fs.readFileSync(path.join(wsDir, 'package.json'), 'utf8'));
  const deps = { ...pkg.dependencies, ...(withDev[ws] ? pkg.devDependencies : {}) };
  for (const name of Object.keys(deps)) {
    if (!installed(name, wsDir)) missing.push(`${name} (${ws})`);
  }
}

if (missing.length) {
  console.error(`\nMissing npm package${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
  console.error('Run this once in the project folder, then try again:\n\n    npm install\n');
  console.error('(It installs what package.json lists with your current npm; it does not upgrade npm or Node.)');
  console.error('Offline machine? Build the bundle on a PC with internet instead: see docs/RUN-WITHOUT-DOCKER.md\n');
  process.exit(1);
}
