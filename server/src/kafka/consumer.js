import { Kafka, logLevel } from 'kafkajs';
import { EventEmitter } from 'node:events';
import config from '../config.js';
import logger from '../logger.js';
import { getAdapter, TEXT_ADAPTERS } from './adapters/index.js';

const CONNECTION_NOISE = /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|EAI_AGAIN|Connection (error|timeout)|Failed to connect to seed broker|Connection closed/i;

/** kafkajs logs every failed connection attempt; keep those for DEBUG=1 and let the retry loop report once. */
const kafkaLogCreator = () => ({ level, log }) => {
  const text = `kafkajs: ${log.message}`;
  if (level <= logLevel.ERROR && !CONNECTION_NOISE.test(log.message)) logger.error(text);
  else if (level === logLevel.WARN && !CONNECTION_NOISE.test(log.message)) logger.warn(text);
  else logger.debug(text);
};

/**
 * Subscribes to the configured topics and feeds every message into the ingest
 * pipeline. Reconnects automatically with back-off if the brokers are down.
 *
 * Events: "status" (status object)
 */
export class GeometryConsumer extends EventEmitter {
  constructor(pipeline) {
    super();
    this.pipeline = pipeline;
    this.topicAdapters = new Map(config.kafka.topics.map(({ topic, adapter }) => [topic, getAdapter(adapter)]));
    this.status = { state: 'idle', brokers: config.kafka.brokers, topics: config.kafka.topics, error: null };
    this.stopped = false;
    this.consumer = null;
  }

  /** Used when the built-in simulator feeds the pipeline instead of Kafka. */
  markSimulated(topics) {
    this.status = { ...this.status, brokers: ['built-in simulator'], topics };
    this.#setStatus('simulated');
  }

  async start() {
    if (!config.kafka.enabled) {
      this.#setStatus('disabled');
      logger.warn('Kafka consumer disabled (KAFKA_ENABLED=false)');
      return;
    }

    const kafka = new Kafka({
      clientId: config.kafka.clientId,
      brokers: config.kafka.brokers,
      ssl: config.kafka.ssl,
      sasl: config.kafka.sasl,
      logLevel: logLevel.WARN,
      logCreator: kafkaLogCreator,
      retry: { retries: 5 },
    });

    // Create missing topics up front; on a fresh cluster subscribing to a
    // non-existent topic otherwise fails until a producer creates it.
    const ensureTopics = async () => {
      const admin = kafka.admin();
      try {
        await admin.connect();
        await admin.createTopics({ topics: [...this.topicAdapters.keys()].map((topic) => ({ topic })) });
      } catch (err) {
        logger.debug(`Could not create topics: ${err.message}`);
      } finally {
        await admin.disconnect().catch(() => {});
      }
    };

    let attempt = 0;
    while (!this.stopped) {
      try {
        this.#setStatus('connecting');
        await ensureTopics();
        this.consumer = kafka.consumer({ groupId: config.kafka.groupId });
        this.consumer.on(this.consumer.events.CRASH, ({ payload }) => {
          this.#setStatus('error', payload?.error?.message);
        });
        this.consumer.on(this.consumer.events.GROUP_JOIN, () => this.#setStatus('connected'));
        this.consumer.on(this.consumer.events.DISCONNECT, () => {
          if (!this.stopped) this.#setStatus('disconnected');
        });

        await this.consumer.connect();
        for (const topic of this.topicAdapters.keys()) {
          await this.consumer.subscribe({ topic, fromBeginning: config.kafka.fromBeginning });
        }
        await this.consumer.run({ eachMessage: (payload) => this.#handle(payload) });
        logger.info(`Kafka consumer running on [${[...this.topicAdapters.keys()].join(', ')}]${attempt ? ` (connected after ${attempt} failed attempts)` : ''}`);
        return;
      } catch (err) {
        attempt += 1;
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
        this.#setStatus('error', err.message);
        // Say it clearly once, then only every 20th attempt (about every 10 minutes); the rest with DEBUG=1.
        if (attempt === 1 || attempt % 20 === 0) {
          logger.warn(
            `Kafka is not reachable at ${config.kafka.brokers.join(', ')} (${err.message}). Retrying in the background; the PPI stays empty until it connects.\n` +
              '    No Kafka on this machine? In server/.env set PPI_SIMULATOR=true (built-in demo feed) or KAFKA_ENABLED=false, then restart.',
          );
        } else {
          logger.debug(`Kafka connection failed (${err.message}); retrying in ${delay / 1000}s`);
        }
        await this.consumer?.disconnect().catch(() => {});
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  async stop() {
    this.stopped = true;
    await this.consumer?.disconnect().catch(() => {});
    this.#setStatus('stopped');
  }

  async #handle({ topic, partition, message }) {
    const meta = {
      topic,
      partition,
      offset: message.offset,
      key: message.key?.toString(),
    };
    const adapter = this.topicAdapters.get(topic);
    const raw = message.value?.toString() ?? '';
    if (TEXT_ADAPTERS.has(adapter)) {
      this.pipeline.ingest(raw, adapter, meta);
      return;
    }
    let value;
    try {
      value = JSON.parse(raw || 'null');
    } catch (err) {
      // Pass through to the pipeline so it is counted and shown in the UI error log.
      this.pipeline.ingest(null, () => {
        throw new Error(`Invalid JSON: ${err.message}`);
      }, meta);
      return;
    }
    this.pipeline.ingest(value, adapter, meta);
  }

  #setStatus(state, error = null) {
    this.status = { ...this.status, state, error, since: Date.now() };
    this.emit('status', this.status);
  }
}
