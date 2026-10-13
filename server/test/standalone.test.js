/**
 * Running without Docker: no MongoDB (settings in a JSON file) and no Kafka
 * (the built-in simulator feeds the PPI).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppi-standalone-'));
process.env.MONGO_URI = '';
process.env.DATA_DIR = tmp;
process.env.PPI_SIMULATOR = 'true';
process.env.SETTINGS_SECRET_KEY = 'test-key-for-standalone';

const { default: config } = await import('../src/config.js');
const { createFileSettingsRepo } = await import('../src/workbench/settingsFileRepo.js');
const { SettingsService } = await import('../src/workbench/settingsService.js');
const { GeometryStore } = await import('../src/services/geometryStore.js');
const { IngestPipeline } = await import('../src/services/ingest.js');
const { startSimulatorFeed } = await import('../src/services/simulatorFeed.js');

test('empty MONGO_URI turns MongoDB off; DATA_DIR and PPI_SIMULATOR are read', () => {
  assert.equal(config.mongo.enabled, false);
  assert.equal(config.dataDir, path.resolve(tmp));
  assert.equal(config.simulator.enabled, true);
  assert.equal(config.simulator.rate, 1);
});

test('settings are saved to and reloaded from the JSON file, secrets encrypted', async () => {
  const file = path.join(tmp, 'settings.json');
  const service = new SettingsService(createFileSettingsRepo(file));
  const current = await service.getPublic();
  await service.update(
    {
      ...current,
      environments: [{ id: 'env-default', name: 'Prod', baseUrl: 'https://api.example.com', basePath: '/v1' }],
      auth: { ...current.auth, type: 'bearer' },
    },
    { token: 'secret-token-123' },
  );

  const raw = fs.readFileSync(file, 'utf8');
  assert.match(raw, /api\.example\.com/);
  assert.doesNotMatch(raw, /secret-token-123/, 'the token is never stored in plain text');

  // A new service (= server restart) reads the same file.
  const again = new SettingsService(createFileSettingsRepo(file));
  const pub = await again.getPublic();
  assert.equal(pub.environments[0].baseUrl, 'https://api.example.com');
  assert.equal(pub.auth.tokenSet, true);
  const { auth } = await again.getForRequest();
  assert.equal(auth.token, 'secret-token-123');
});

test('a missing settings file means default settings', async () => {
  const repo = createFileSettingsRepo(path.join(tmp, 'nope', 'settings.json'));
  assert.deepEqual(await repo.load(), { data: {}, secrets: {} });
});

test('the built-in simulator fills the PPI picture without Kafka', () => {
  const store = new GeometryStore(config.picture);
  const pipeline = new IngestPipeline({ store, persistence: { recordEvent() {} } });
  const feed = startSimulatorFeed(pipeline, { rate: 1 });
  try {
    assert.ok(store.size > 10, `expected objects on the picture, got ${store.size}`);
    assert.equal(pipeline.stats.rejected, 0, JSON.stringify(pipeline.recentErrors.slice(0, 3)));
    assert.ok(feed.topics.some((t) => t.adapter === 'nmea0183'));
    assert.ok(store.get('OWNSHIP'), 'own ship is on the picture');
  } finally {
    feed.stop();
    clearInterval(pipeline.rateTimer);
  }
});
