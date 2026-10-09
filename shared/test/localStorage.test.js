import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkbenchService, createLocalStorageStore, exportWorkspace, importWorkspace, workspaceUsage } from '../workbench/index.js';
import { withDefaults } from '../settings/index.js';

const samples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../samples/openapi');
const sample = (rel, name = path.basename(rel)) => ({ fileName: name, text: fs.readFileSync(path.join(samples, rel), 'utf8') });
const settings = withDefaults({});

/** A browser's localStorage (one per PC / profile), with an optional size quota in characters. */
class FakeStorage {
  constructor(quotaChars = Infinity) {
    this.map = new Map();
    this.quota = quotaChars;
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    const used = [...this.map].reduce((n, [kk, vv]) => n + (kk === k ? 0 : kk.length + vv.length), 0);
    if (used + k.length + String(v).length > this.quota) {
      const e = new Error('quota');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

// Five distinct files for PC 1 and three for PC 2, made from the samples.
const fiveFiles = [
  sample('payment-service/payment-api.yaml'),
  sample('payment-service/payment-v2.yaml'),
  sample('payment-service/payment-admin.yaml'),
  sample('payment-service/payment-webhook.yaml'),
  sample('user-service/user-api.yaml', 'payment-users.yaml'),
];
const threeFiles = [sample('user-service/user-api.yaml'), sample('payment-service/payment-v2.yaml', 'user-v2.yaml'), sample('payment-service/payment-webhook.yaml', 'user-events.yaml')];

test('PC 1 sees only its 5 files and PC 2 only its 3 (8 in total, never mixed)', async () => {
  const pc1 = new WorkbenchService(createLocalStorageStore(new FakeStorage()));
  const pc2 = new WorkbenchService(createLocalStorageStore(new FakeStorage()));

  const p1 = await pc1.createProject({ name: 'Payment Service' });
  const p2 = await pc2.createProject({ name: 'Payment Service' }); // same name on another PC is fine
  assert.equal((await pc1.uploadYamlFiles(p1.id, fiveFiles, settings)).succeeded, 5);
  assert.equal((await pc2.uploadYamlFiles(p2.id, threeFiles, settings)).succeeded, 3);

  assert.equal((await pc1.listYamlFiles(p1.id)).length, 5);
  assert.equal((await pc2.listYamlFiles(p2.id)).length, 3);
  assert.deepEqual((await pc1.listProjects()).map((p) => p.yamlCount), [5]);
  assert.deepEqual((await pc2.listProjects()).map((p) => p.yamlCount), [3]);
  await assert.rejects(pc2.listYamlFiles(p1.id), (e) => e.code === 'NOT_FOUND', "PC 2 cannot open PC 1's project");
});

test('the workspace survives a page reload (new store over the same storage)', async () => {
  const storage = new FakeStorage();
  const first = new WorkbenchService(createLocalStorageStore(storage));
  const p = await first.createProject({ name: 'User Service' });
  await first.uploadYamlFiles(p.id, [sample('user-service/user-api.yaml')], settings);

  const reloaded = new WorkbenchService(createLocalStorageStore(storage));
  const [project] = await reloaded.listProjects();
  assert.equal(project.name, 'User Service');
  const [file] = await reloaded.listYamlFiles(project.id);
  const full = await reloaded.getYamlFile(file.id);
  assert.match(full.content, /User API/);
  assert.equal(full.endpoints.length, 5);
});

test('updating and deleting only touch this browser', async () => {
  const s1 = new FakeStorage();
  const s2 = new FakeStorage();
  const pc1 = new WorkbenchService(createLocalStorageStore(s1));
  const pc2 = new WorkbenchService(createLocalStorageStore(s2));
  const a = await pc1.createProject({ name: 'A' });
  const b = await pc2.createProject({ name: 'B' });
  const up1 = await pc1.uploadYamlFiles(a.id, [sample('user-service/user-api.yaml')], settings);
  await pc2.uploadYamlFiles(b.id, [sample('user-service/user-api.yaml')], settings);
  const before2 = JSON.stringify([...s2.map]);

  const again = await pc1.uploadYamlFiles(a.id, [sample('user-service/user-api.yaml')], settings);
  assert.equal(again.results[0].status, 'updated');
  await pc1.deleteYamlFile(up1.results[0].id);
  await pc1.deleteProject(a.id);

  assert.equal(JSON.stringify([...s2.map]), before2, "PC 2's storage is untouched");
  assert.equal([...s1.map.keys()].filter((k) => k !== 'ppiwb.v1.projects' && k !== 'ppiwb.v1.yamlFiles').length, 0, 'no leftovers on PC 1');
});

test('a full browser storage rejects the file cleanly and keeps the rest', async () => {
  const storage = new FakeStorage(12000);
  const svc = new WorkbenchService(createLocalStorageStore(storage));
  const p = await svc.createProject({ name: 'Small' });
  const out = await svc.uploadYamlFiles(p.id, [sample('payment-service/payment-v2.yaml'), sample('payment-service/payment-api.yaml')], settings);
  assert.equal(out.results[0].status, 'created');
  assert.equal(out.results[1].error.code, 'STORAGE_FULL');
  assert.deepEqual((await svc.listYamlFiles(p.id)).map((f) => f.fileName), ['payment-v2.yaml']);
  assert.ok(![...storage.map.keys()].some((k) => k.startsWith('ppiwb.v1.yaml.') && !storage.getItem('ppiwb.v1.yamlFiles').includes(k.slice(14))));
});

test('export and import move a workspace to another browser', async () => {
  const from = new FakeStorage();
  const svc = new WorkbenchService(createLocalStorageStore(from));
  const p = await svc.createProject({ name: 'Payment Service' });
  await svc.uploadYamlFiles(p.id, fiveFiles.slice(0, 2), settings);
  const backup = JSON.parse(JSON.stringify(exportWorkspace(from)));
  assert.ok(workspaceUsage(from) > 0);

  const to = new FakeStorage();
  importWorkspace(to, backup);
  const moved = new WorkbenchService(createLocalStorageStore(to));
  const [proj] = await moved.listProjects();
  assert.equal((await moved.listYamlFiles(proj.id)).length, 2);
  assert.throws(() => importWorkspace(to, { format: 'other' }), (e) => e.code === 'IMPORT_INVALID');
  assert.equal((await moved.listProjects()).length, 1, 'a rejected import changes nothing');
});
