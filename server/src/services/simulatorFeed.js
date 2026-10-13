/**
 * Built-in PPI feed for installations without Kafka (PPI_SIMULATOR=true).
 * Runs the demo naval scenario (the same one scripts/simulator.js publishes
 * to Kafka) and passes every message through the adapter bound to its topic,
 * exactly as the Kafka consumer would.
 */
import { createScenario, TOPIC_ADAPTERS } from '../../scripts/lib/scenario.js';
import { getAdapter } from '../kafka/adapters/index.js';
import logger from '../logger.js';

export function startSimulatorFeed(pipeline, { rate = 1 } = {}) {
  const scenario = createScenario({ rate });
  const adapters = new Map(Object.values(scenario.topics).map((topic) => [topic, getAdapter(TOPIC_ADAPTERS[topic])]));

  const tick = () => {
    try {
      for (const { topic, messages } of scenario.step()) {
        const adapter = adapters.get(topic);
        for (const m of messages) pipeline.ingest(m, adapter, { topic });
      }
    } catch (err) {
      logger.error('Simulator step failed:', err.message);
    }
  };

  tick();
  const timer = setInterval(tick, 1000 / rate);
  logger.info(`Built-in PPI simulator running (${rate} update/s) - Kafka is not used`);
  return {
    topics: [...adapters.keys()].map((topic) => ({ topic, adapter: TOPIC_ADAPTERS[topic] })),
    stop: () => clearInterval(timer),
  };
}
