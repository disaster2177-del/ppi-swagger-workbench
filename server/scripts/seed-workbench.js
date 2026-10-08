/**
 * Load example projects and YAML files into MongoDB.
 *
 *   npm run seed                         uses samples/openapi/projects.json
 *   npm run seed -- path/to/projects.json
 *
 * The manifest names the projects; every .yaml/.yml file in each project's
 * folder goes through the same validation as an upload in the UI. Existing
 * projects are reused and files with the same name are replaced.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { connectMongo } from '../src/db.js';
import { createWorkbench } from '../src/workbench/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(process.argv[2] ?? path.join(here, '../../samples/openapi/projects.json'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const baseDir = path.dirname(manifestPath);

await connectMongo();
const { workbench, settings } = createWorkbench();
const current = await settings.getPublic();

for (const [folder, info] of Object.entries(manifest.projects ?? {})) {
  const existing = (await workbench.listProjects()).find((p) => p.name.toLowerCase() === info.name.toLowerCase());
  const project = existing ?? (await workbench.createProject(info));
  const dir = path.join(baseDir, folder);
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/i.test(f))
    .map((f) => ({ fileName: f, text: fs.readFileSync(path.join(dir, f), 'utf8') }));
  const out = await workbench.uploadYamlFiles(project.id, files, { ...current, validation: { ...current.validation, duplicatePolicy: 'replace' } });
  console.log(`${project.name}: ${out.succeeded} stored, ${out.failed} rejected`);
  for (const r of out.results.filter((x) => x.status === 'failed')) console.log(`  ✗ ${r.fileName}: ${r.error.message}`);
}

await mongoose.disconnect();
