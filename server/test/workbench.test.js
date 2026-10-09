import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SETTINGS_SECRET_KEY ??= 'test-key-for-unit-tests';
const { SettingsService } = await import('../src/workbench/settingsService.js');
const { ExecuteService } = await import('../src/workbench/executeService.js');
const { describeNetworkError, causeCode } = await import('../src/workbench/networkErrors.js');

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

const okFetch = (sink) => async (url, init) => {
  sink.url = String(url);
  sink.init = init;
  return new Response(JSON.stringify([{ id: 1 }]), { status: 200, headers: { 'content-type': 'application/json' } });
};

// The request reported from the VM (YAML server https://api.example.com/v1, no Base URL in Settings).
const REPORTED = {
  method: 'GET',
  path: '/users',
  query: [
    ['limit', '20'],
    ['offset', '2'],
    ['sort', 'name'],
    ['status', 'active'],
  ],
  headers: {},
  serverUrl: 'https://api.example.com/v1',
};

test('reported request: query is appended to the YAML server + endpoint path', async () => {
  const settings = new SettingsService(memoryRepo());
  const sink = {};
  await new ExecuteService({ settings, fetchImpl: okFetch(sink) }).execute(REPORTED);
  assert.equal(sink.url, 'https://api.example.com/v1/users?limit=20&offset=2&sort=name&status=active');
  assert.equal(sink.init.method, 'GET');
});

test('Base URL + Base Path from Settings take precedence over the YAML server', async () => {
  const settings = new SettingsService(memoryRepo());
  await settings.update({ environments: [{ id: 'e', name: 'VM', baseUrl: 'http://10.0.0.5:8080', basePath: '/api/v1' }], activeEnvironmentId: 'e' });
  const sink = {};
  await new ExecuteService({ settings, fetchImpl: okFetch(sink) }).execute(REPORTED);
  assert.equal(sink.url, 'http://10.0.0.5:8080/api/v1/users?limit=20&offset=2&sort=name&status=active');
});

test('an unreachable host gives a 502 that names the host, the URL and the reason', async () => {
  const settings = new SettingsService(memoryRepo());
  const dnsFail = async () => {
    throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.example.com'), { code: 'ENOTFOUND' }) });
  };
  await assert.rejects(new ExecuteService({ settings, fetchImpl: dnsFail }).execute(REPORTED), (e) => {
    assert.equal(e.status, 502);
    assert.equal(e.code, 'NETWORK');
    assert.match(e.message, /"api\.example\.com" could not be found/);
    assert.match(e.message, /placeholder/);
    assert.equal(e.details.url, 'https://api.example.com/v1/users?limit=20&offset=2&sort=name&status=active');
    assert.equal(e.details.reason, 'ENOTFOUND');
    return true;
  });
});

test('network error causes are recognised, including nested and aggregate errors', () => {
  assert.equal(causeCode(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })), 'ECONNREFUSED');
  assert.equal(causeCode(new TypeError('fetch failed', { cause: { errors: [{ code: 'ECONNREFUSED' }] } })), 'ECONNREFUSED');
  assert.match(describeNetworkError('ECONNREFUSED', 'http://localhost:3000/x').title, /localhost:3000 refused/);
  assert.match(describeNetworkError('SELF_SIGNED_CERT_IN_CHAIN', 'https://x.corp/').hint, /NODE_EXTRA_CA_CERTS/);
});

test('credentials are encrypted at rest, never returned, and added by the server', async () => {
  const repo = memoryRepo();
  const settings = new SettingsService(repo);
  const pub = await settings.update({ auth: { type: 'bearer' } }, { token: 's3cret-token' });
  assert.equal(pub.auth.tokenSet, true);
  assert.equal(JSON.stringify(pub).includes('s3cret'), false);
  assert.equal(JSON.stringify(repo.raw()).includes('s3cret'), false);
  const sink = {};
  await new ExecuteService({ settings, fetchImpl: okFetch(sink) }).execute({ ...REPORTED, headers: { Host: 'evil' } });
  assert.equal(sink.init.headers.Authorization, 'Bearer s3cret-token');
  assert.equal(sink.init.headers.Host, undefined);
  assert.equal((await settings.update({}, { token: null })).auth.tokenSet, false);
});

test('timeouts, bad paths, missing base and blocked targets are refused clearly', async () => {
  const settings = new SettingsService(memoryRepo());
  await settings.update({ request: { timeoutMs: 1000 } });
  const hang = (_u, init) => new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  await assert.rejects(new ExecuteService({ settings, fetchImpl: hang }).execute(REPORTED), (e) => e.code === 'TIMEOUT' && e.status === 504);

  const exec = new ExecuteService({ settings, fetchImpl: okFetch({}) });
  await assert.rejects(exec.execute({ ...REPORTED, path: '//evil.example.com/x' }), /not valid/);
  await assert.rejects(exec.execute({ ...REPORTED, path: '/users/{id}' }), (e) => e.code === 'REQUIRED_FIELDS');
  await assert.rejects(exec.execute({ ...REPORTED, serverUrl: '' }), (e) => e.code === 'NO_BASE_URL');
  await assert.rejects(exec.execute({ ...REPORTED, serverUrl: 'http://169.254.169.254/latest' }), (e) => e.code === 'TARGET_BLOCKED');

  process.env.WORKBENCH_ALLOWED_HOSTS = '*.internal.corp';
  try {
    await assert.rejects(exec.execute(REPORTED), (e) => e.code === 'TARGET_BLOCKED');
    await exec.execute({ ...REPORTED, serverUrl: 'https://users.internal.corp' });
  } finally {
    delete process.env.WORKBENCH_ALLOWED_HOSTS;
  }
});

test('Swagger UI view: a full URL is called as-is, still with server auth and target checks', async () => {
  const settings = new SettingsService(memoryRepo());
  await settings.update({ auth: { type: 'apiKey', apiKeyName: 'X-API-Key', apiKeyIn: 'header' } }, { apiKeyValue: 'k1' });
  const sink = {};
  const exec = new ExecuteService({ settings, fetchImpl: okFetch(sink) });
  await exec.execute({ method: 'PATCH', url: 'https://api.example.com/v1/users/7?x=1', headers: {}, body: { kind: 'text', mediaType: 'application/json', text: '{"a":1}' } });
  assert.equal(sink.url, 'https://api.example.com/v1/users/7?x=1');
  assert.equal(sink.init.method, 'PATCH');
  assert.equal(sink.init.headers['X-API-Key'], 'k1');
  assert.equal(sink.init.body, '{"a":1}');
  await assert.rejects(exec.execute({ method: 'GET', url: 'http://169.254.169.254/' }), (e) => e.code === 'TARGET_BLOCKED');
  await assert.rejects(exec.execute({ method: 'GET', url: 'file:///etc/passwd' }), (e) => e.code === 'NO_BASE_URL');
});
