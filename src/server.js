'use strict';

const path = require('node:path');

// Loaded before anything else so configuration is available to the app and db layers.
require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env'),
  quiet: true,
});

const app = require('./app');
const { closePool, getSslSummary } = require('./config/db');
const databaseModel = require('./models/databaseModel');

const PORT = Number(process.env.PORT) || 3000;

let server;

/**
 * Verifies PostgreSQL connectivity before exposing the API, so a broken
 * configuration fails fast instead of surfacing later as request errors.
 */
const connectDatabase = async () => {
  try {
    const { version, database } = await databaseModel.ping();
    console.log(`[db] connected to "${database}" - ${version}`);
    console.log(`[db] ssl: ${getSslSummary()}`);
  } catch (error) {
    console.error(`[db] connection failed: ${error.message}`);
    console.error(
      '[db] check DATABASE_URL, DB_SSL_* settings, and that the database host allows connections from this network.',
    );

    await closePool();
    process.exit(1);
  }
};

const start = async () => {
  await connectDatabase();

  server = app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
  });

  server.on('error', (error) => {
    console.error(`[server] failed to start: ${error.message}`);
    process.exit(1);
  });
};

/** Releases the HTTP server and the connection pool on termination signals. */
const shutdown = async (signal) => {
  console.log(`[server] ${signal} received, shutting down gracefully...`);

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  await closePool();
  process.exit(0);
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shutdown(signal);
  });
}

start();
