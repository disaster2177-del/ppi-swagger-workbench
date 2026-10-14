import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Settings file, whichever folder the server is started from:
//   ENV_FILE=/path/to/file, else server/.env, else the .env in the project root (the one next to docker-compose.yml).
// Variables already set in the environment (shell export, systemd EnvironmentFile, Docker) win over the file.
const KEY_VARS = ['MONGO_URI', 'PPI_SIMULATOR', 'KAFKA_ENABLED', 'KAFKA_BROKERS'];
const fromEnvironment = KEY_VARS.filter((k) => process.env[k] !== undefined);
const candidates = process.env.ENV_FILE ? [path.resolve(process.env.ENV_FILE)] : [path.join(serverDir, '.env'), path.join(serverDir, '..', '.env')];
const envFile = candidates.find((f) => fs.existsSync(f)) ?? candidates[0];
const envFileLoaded = fs.existsSync(envFile);
if (envFileLoaded) dotenv.config({ path: envFile, quiet: true });

const bool = (v, def = false) => (v === undefined || v === '' ? def : /^(1|true|yes)$/i.test(v));
const num = (v, def) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? def : Number(v));
const list = (v, def = []) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : def);

/**
 * KAFKA_TOPICS entries look like "topic" or "topic:adapterName".
 */
function parseTopics(value) {
  const defaults = [
    'radar.geometry',
    'radar.tracks',
    'radar.ownship',
    'radar.legacy-plots:legacyPlot',
    'radar.nmea:nmea0183',
    'ais.nmea:nmea0183',
    'c2.zones',
  ];
  return list(value, defaults).map((entry) => {
    const [topic, adapter = 'canonical'] = entry.split(':').map((s) => s.trim());
    return { topic, adapter };
  });
}

// MONGO_URI not set at all -> local MongoDB (Docker / development default).
// MONGO_URI set but empty, or "none" -> run without MongoDB (settings in DATA_DIR/settings.json).
const mongoUri = process.env.MONGO_URI === undefined ? 'mongodb://localhost:27017/naval_geometry' : process.env.MONGO_URI.trim();

const config = {
  // Where the settings came from (printed at startup).
  envSource: { file: envFile, loaded: envFileLoaded, fromEnvironment },
  port: num(process.env.PORT, 4000),
  // npm run dev: serve the UI live from client/src (Vite) instead of the built client/dist.
  devUi: process.argv.includes('--dev-ui') || bool(process.env.DEV_UI, false),
  // Interface to listen on: empty = all interfaces; 127.0.0.1 = this machine only (behind nginx, say).
  host: process.env.HOST || undefined,
  corsOrigin: list(process.env.CORS_ORIGIN, ['http://localhost:5173']),
  // Where the server keeps its own files (settings.json without MongoDB, settings.key).
  dataDir: path.resolve(serverDir, process.env.DATA_DIR || '.data'),

  mongo: {
    enabled: !!mongoUri && mongoUri.toLowerCase() !== 'none',
    uri: mongoUri,
    persistHistory: bool(process.env.PERSIST_HISTORY, true),
    historyTtlHours: num(process.env.HISTORY_TTL_HOURS, 24),
  },

  kafka: {
    enabled: bool(process.env.KAFKA_ENABLED, true),
    brokers: list(process.env.KAFKA_BROKERS, ['localhost:9092']),
    clientId: process.env.KAFKA_CLIENT_ID || 'naval-geometry-server',
    groupId: process.env.KAFKA_GROUP_ID || 'naval-geometry-ui',
    topics: parseTopics(process.env.KAFKA_TOPICS),
    fromBeginning: bool(process.env.KAFKA_FROM_BEGINNING, false),
    ssl: bool(process.env.KAFKA_SSL, false),
    sasl: process.env.KAFKA_SASL_MECHANISM
      ? {
          mechanism: process.env.KAFKA_SASL_MECHANISM,
          username: process.env.KAFKA_SASL_USERNAME,
          password: process.env.KAFKA_SASL_PASSWORD,
        }
      : undefined,
  },

  // Built-in PPI feed: the demo naval scenario, fed straight into the pipeline (no Kafka needed).
  simulator: {
    enabled: bool(process.env.PPI_SIMULATOR, false),
    rate: Math.min(10, Math.max(0.2, num(process.env.PPI_SIMULATOR_RATE, 1))),
  },

  picture: {
    defaultTtlSec: num(process.env.DEFAULT_TTL_SEC, 120),
    trackHistoryLength: num(process.env.TRACK_HISTORY_LENGTH, 30),
    broadcastIntervalMs: num(process.env.BROADCAST_INTERVAL_MS, 200),
  },
};

export default config;
