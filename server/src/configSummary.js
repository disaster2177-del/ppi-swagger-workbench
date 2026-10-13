/**
 * The startup lines that say which settings file was read and what runs, so
 * "why is it trying Kafka / MongoDB?" is answered by the first lines of the log.
 */
export function describeConfiguration(config) {
  const { file, loaded, fromEnvironment } = config.envSource;
  const lines = [
    loaded
      ? `Configuration: ${file}`
      : `Configuration: no .env file found (looked for ${file}) - using environment variables and built-in defaults. Copy server/.env.example to server/.env`,
  ];
  if (fromEnvironment.length) lines.push(`  Set in the environment (these win over the .env file): ${fromEnvironment.join(', ')}`);
  const safeUri = config.mongo.uri.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@');
  lines.push(
    `  MongoDB:  ${config.mongo.enabled ? `${safeUri}  (set MONGO_URI= empty to run without MongoDB)` : 'not used (MONGO_URI is empty) - Settings saved in a file'}`,
  );
  lines.push(
    `  PPI feed: ${
      config.simulator.enabled
        ? 'built-in simulator (PPI_SIMULATOR=true) - Kafka not used'
        : config.kafka.enabled
          ? `Kafka at ${config.kafka.brokers.join(', ')}  (set PPI_SIMULATOR=true for the built-in demo feed instead)`
          : 'none (KAFKA_ENABLED=false and PPI_SIMULATOR is not true)'
    }`,
  );
  return lines;
}
