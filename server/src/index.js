import http from 'node:http';
import config from './config.js';
import logger from './logger.js';
import { connectMongo } from './db.js';
import { createApp } from './app.js';
import { createSocketServer } from './socket.js';
import { GeometryStore } from './services/geometryStore.js';
import { Persistence } from './services/persistence.js';
import { IngestPipeline } from './services/ingest.js';
import { GeometryConsumer } from './kafka/consumer.js';
import { createWorkbench } from './workbench/index.js';
import { startSimulatorFeed } from './services/simulatorFeed.js';

async function main() {
  const store = new GeometryStore(config.picture);
  const persistence = new Persistence(store);
  const pipeline = new IngestPipeline({ store, persistence });
  const consumer = new GeometryConsumer(pipeline);

  if (config.mongo.enabled) {
    try {
      await connectMongo();
      const saved = await persistence.loadLivePicture();
      store.hydrate(saved);
      logger.info(`Restored ${store.size} objects from MongoDB`);
    } catch (err) {
      logger.error(
        `MongoDB unavailable (${err.message}) - PPI picture kept in memory only and Settings cannot be saved. ` +
          'To run without MongoDB, set MONGO_URI= (empty) in .env.',
      );
    }
  } else {
    logger.info('MongoDB not used (MONGO_URI is empty): PPI picture kept in memory, no PPI history');
  }

  const workbench = createWorkbench();
  logger.info(`Settings stored in ${workbench.settingsStore}`);
  const app = createApp({ store, pipeline, persistence, consumer, workbench });
  const server = http.createServer(app);
  const sockets = createSocketServer(server, { store, pipeline, consumer });

  server.listen(config.port, config.host, () => {
    logger.info(`API + WebSocket listening on ${config.host ?? '*'}:${config.port}`);
    logger.info(`Open http://${config.host && config.host !== '0.0.0.0' ? config.host : 'localhost'}:${config.port} (or http://<this-machine's-IP>:${config.port} from other PCs)`);
  });

  let simulator = null;
  if (config.simulator.enabled) {
    simulator = startSimulatorFeed(pipeline, { rate: config.simulator.rate });
    consumer.markSimulated(simulator.topics);
  } else {
    // Do not block startup on Kafka - it reconnects in the background.
    consumer.start().catch((err) => logger.error('Kafka consumer stopped:', err));
  }

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down`);
    simulator?.stop();
    await consumer.stop();
    sockets.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
