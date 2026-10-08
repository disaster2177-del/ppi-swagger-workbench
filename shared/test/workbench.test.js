import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStore, WorkbenchService } from '../workbench/index.js';
import { DEFAULT_SETTINGS, sanitizeSettings, SettingsValidationError } from '../settings/index.js';

const samples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../samples/openapi');
const file = (rel, name = path.basename(rel)) => ({ fileName: name, text: fs.readFileSync(path.join(samples, rel), 'utf8') });
const settings = sanitizeSettings({}, DEFAULT_SETTINGS);

test('projects are real entities with unique names', async () => {
  const svc = new WorkbenchService(new MemoryStore());
  const a = await svc.createProject({ name: '  Payment   Service ' });
  assert.equal(a.name, 'Payment Service');
  await assert.rejects(svc.createProject({ name: 'payment service' }), (e) => e.code === 'PROJECT_EXISTS');
  await assert.rejects(svc.createProject({ name: '' }), (e) => e.code === 'PROJECT_NAME_REQUIRED');
  const renamed = await svc.updateProject(a.id, { name: 'Payments' });
  assert.equal(renamed.slug, 'payments');
});

test('bulk upload stores valid files, rejects invalid ones and reports each file', async () => {
  const svc = new WorkbenchService(new MemoryStore());
  const p = await svc.createProject({ name: 'Payment Service' });
  const out = await svc.uploadYamlFiles(
    p.id,
    [
      file('payment-service/payment-api.yaml'),
      file('payment-service/payment-v2.yaml'),
      file('invalid/broken-indentation.yaml'),
      file('invalid/not-openapi.yaml'),
      { fileName: 'notes.txt', text: 'hello' },
    ],
    settings,
  );
  assert.equal(out.succeeded, 2);
  assert.equal(out.failed, 3);
  assert.deepEqual(
    out.results.map((r) => r.error?.code ?? r.status),
    ['created', 'created', 'INVALID_YAML', 'INVALID_OPENAPI', 'UNSUPPORTED_TYPE'],
  );
  const files = await svc.listYamlFiles(p.id);
  assert.deepEqual(files.map((f) => f.fileName), ['payment-api.yaml', 'payment-v2.yaml']);
  assert.equal(files[0].content, undefined, 'lists do not carry YAML content');
  assert.equal(files[0].filePath, 'projects/payment-service/payment-api.yaml');
  assert.ok(files[0].createdAt && files[0].updatedAt);

  const full = await svc.getYamlFile(files[0].id);
  assert.match(full.content, /Payment API/);
  assert.equal(full.endpoints.length, 6);
  assert.ok(full.endpoints.every((e) => e.projectId === p.id && e.yamlFileId === full.id));
});

test('YAML files are scoped to their project', async () => {
  const svc = new WorkbenchService(new MemoryStore());
  const pay = await svc.createProject({ name: 'Payment Service' });
  const users = await svc.createProject({ name: 'User Service' });
  await svc.uploadYamlFiles(pay.id, [file('payment-service/payment-api.yaml')], settings);
  await svc.uploadYamlFiles(users.id, [file('user-service/user-api.yaml')], settings);
  assert.deepEqual((await svc.listYamlFiles(users.id)).map((f) => f.fileName), ['user-api.yaml']);
  assert.deepEqual((await svc.listYamlFiles(pay.id, { search: 'PAYMENT' })).map((f) => f.fileName), ['payment-api.yaml']);
  const projects = await svc.listProjects();
  assert.deepEqual(projects.map((x) => [x.name, x.yamlCount]), [['Payment Service', 1], ['User Service', 1]]);
});

test('duplicate names: replace updates in place, rename keeps both, reject fails', async () => {
  const svc = new WorkbenchService(new MemoryStore());
  const p = await svc.createProject({ name: 'P' });
  const first = await svc.uploadYamlFiles(p.id, [file('user-service/user-api.yaml')], settings);
  const again = await svc.uploadYamlFiles(p.id, [file('user-service/user-api.yaml')], settings);
  assert.equal(again.results[0].status, 'updated');
  assert.equal(again.results[0].id, first.results[0].id);

  const renameSettings = { ...settings, validation: { ...settings.validation, duplicatePolicy: 'rename' } };
  const renamed = await svc.uploadYamlFiles(p.id, [file('user-service/user-api.yaml')], renameSettings);
  assert.equal(renamed.results[0].fileName, 'user-api (2).yaml');

  const rejectSettings = { ...settings, validation: { ...settings.validation, duplicatePolicy: 'reject' } };
  const rejected = await svc.uploadYamlFiles(p.id, [file('user-service/user-api.yaml')], rejectSettings);
  assert.equal(rejected.results[0].error.code, 'DUPLICATE_FILE');
});

test('upload needs a project; size limit is enforced', async () => {
  const svc = new WorkbenchService(new MemoryStore());
  await assert.rejects(svc.uploadYamlFiles('', [file('user-service/user-api.yaml')], settings), (e) => e.code === 'NO_PROJECT');
  const p = await svc.createProject({ name: 'P' });
  const tiny = { ...settings, validation: { ...settings.validation, maxFileSizeKb: 1 } };
  const out = await svc.uploadYamlFiles(p.id, [file('payment-service/payment-api.yaml')], tiny);
  assert.equal(out.results[0].error.code, 'FILE_TOO_LARGE');
});

test('deleting a project removes its YAML files and endpoints', async () => {
  const store = new MemoryStore();
  const svc = new WorkbenchService(store);
  const p = await svc.createProject({ name: 'P' });
  const up = await svc.uploadYamlFiles(p.id, [file('user-service/user-api.yaml')], settings);
  await svc.deleteProject(p.id);
  assert.equal(await store.yamlFiles.get(up.results[0].id), null);
  assert.deepEqual(await store.endpoints.listByYamlFile(up.results[0].id), []);
});

test('settings: base URL/path checks, header checks, secrets never accepted from clients', () => {
  const s = sanitizeSettings({
    environments: [{ id: 'e1', name: 'Prod', baseUrl: 'https://api.example.com', basePath: '/api/v1' }],
    activeEnvironmentId: 'e1',
    auth: { type: 'bearer', token: 'leak', tokenSet: true },
  });
  assert.equal(s.environments[0].basePath, '/api/v1');
  assert.equal(s.auth.token, undefined);
  assert.equal(s.auth.tokenSet, false);
  assert.throws(
    () => sanitizeSettings({ environments: [{ baseUrl: 'ftp://x', basePath: 'api' }] }),
    (e) => e instanceof SettingsValidationError && !!e.fields['environments.0.baseUrl'] && !!e.fields['environments.0.basePath'],
  );
  assert.throws(() => sanitizeSettings({ request: { defaultHeaders: [{ name: 'Bad Header', value: 'x' }] } }), SettingsValidationError);
});
