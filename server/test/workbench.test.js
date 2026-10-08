import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStore, WorkbenchService } from '@workbench/shared/workbench';

process.env.SETTINGS_SECRET_KEY ??= 'test-key-for-unit-tests';
const { SettingsService } = await import('../src/workbench/settingsService.js');
const { ExecuteService } = await import('../src/workbench/executeService.js');

const samples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../samples/openapi');

function memoryRepo() {
  let saved = { data: {}, secrets: {} };
  return {
    load: async () => structuredClone(saved),
    save: async (v) => {
      saved = structuredClone(v);
    },
    raw: () => saved,
  };
}

async function setup() {
  const workbench = new WorkbenchService(new MemoryStore());
  const repo = memoryRepo();
  const settings = new SettingsService(repo);
  const project = await workbench.createProject({ name: 'User Service' });
  const up = await workbench.uploadYamlFiles(
    project.id,
    [{ fileName: 'user-api.yaml', text: fs.readFileSync(path.join(samples, 'user-service/user-api.yaml'), 'utf8') }],
    await settings.getPublic(),
  );
  return { workbench, settings, repo, yamlFileId: up.results[0].id };
}

test('credentials are encrypted at rest and never returned to the browser', async () => {
  const { settings, repo } = await setup();
  const pub = await settings.update({ auth: { type: 'bearer' } }, { token: 's3cret-token' });
  assert.equal(pub.auth.tokenSet, true);
  assert.equal(JSON.stringify(pub).includes('s3cret'), false);
  assert.equal(JSON.stringify(repo.raw()).includes('s3cret'), false);
  assert.equal((await settings.getForRequest()).auth.token, 's3cret-token');

  const cleared = await settings.update({}, { token: null });
  assert.equal(cleared.auth.tokenSet, false);
});

test('execute: URL from Base URL + Base Path, auth added on the server, timeout enforced', async () => {
  const { workbench, settings, yamlFileId } = await setup();
  await settings.update(
    {
      environments: [{ id: 'e1', name: 'Prod', baseUrl: 'https://api.example.com', basePath: '/api/v1' }],
      activeEnvironmentId: 'e1',
      auth: { type: 'bearer' },
      request: { timeoutMs: 1000, defaultHeaders: [{ name: 'X-Team', value: 'radar' }] },
    },
    { token: 'tok' },
  );

  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify({ id: 42 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const exec = new ExecuteService({ workbench, settings, fetchImpl });
  const out = await exec.execute({ yamlFileId, method: 'GET', path: '/users/42', query: [['status', 'active']], headers: { Host: 'evil' } });
  assert.equal(seen.url, 'https://api.example.com/api/v1/users/42?status=active');
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  assert.equal(seen.init.headers['X-Team'], 'radar');
  assert.equal(seen.init.headers.Host, undefined);
  assert.equal(out.status, 200);
  assert.equal(JSON.parse(out.body).id, 42);

  await assert.rejects(exec.execute({ yamlFileId, method: 'GET', path: '//evil.example.com/x' }), /not valid/);
  await assert.rejects(exec.execute({ yamlFileId, method: 'GET', path: '/users/{id}' }), (e) => e.code === 'REQUIRED_FIELDS');

  const slow = new ExecuteService({
    workbench,
    settings,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
  });
  await assert.rejects(slow.execute({ yamlFileId, method: 'GET', path: '/users' }), (e) => e.code === 'TIMEOUT');

  const down = new ExecuteService({ workbench, settings, fetchImpl: async () => Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })) });
  await assert.rejects(down.execute({ yamlFileId, method: 'GET', path: '/users' }), (e) => e.code === 'NETWORK' && e.status === 502);
});

test('execute falls back to the YAML server when no Base URL is set', async () => {
  const { workbench, settings, yamlFileId } = await setup();
  let url;
  const exec = new ExecuteService({ workbench, settings, fetchImpl: async (u) => ((url = String(u)), new Response(null, { status: 204 })) });
  await exec.execute({ yamlFileId, method: 'DELETE', path: '/users/7' });
  assert.equal(url, 'https://api.example.com/users/7');
});
