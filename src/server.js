'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Configuration files are loaded before anything else.
 * `.env.local` (git-ignored developer overrides, e.g. a local Docker database)
 * takes precedence over `.env` (deployment values). Set ENV_FILE to load a
 * single explicit file instead, e.g. `ENV_FILE=.env.production npm start`.
 */
const envFileNames = process.env.ENV_FILE ? [process.env.ENV_FILE] : ['.env.local', '.env'];
const envFilePaths = envFileNames.map((fileName) => path.resolve(PROJECT_ROOT, fileName));

require('dotenv').config({ path: envFilePaths, quiet: true });

const loadedEnvFiles = envFilePaths.filter((filePath) => fs.existsSync(filePath));

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

    // Guarded because an invalid DB_SSL_MODE makes the SSL config itself throw.
    const sslSummary = (() => {
      try {
        return getSslSummary();
      } catch {
        return 'unknown';
      }
    })();

    if (sslSummary.startsWith('enabled')) {
      console.error(
        '[db] if this is a local PostgreSQL container without TLS, use .env.local.example (DB_SSL_MODE=disable).',
      );
    }

    console.error(
      '[db] check DATABASE_URL, DB_SSL_* settings, and that the database host allows connections from this network.',
    );

    await closePool();
    process.exit(1);
  }
};

const start = async () => {
  console.log(
    loadedEnvFiles.length > 0
      ? `[env] loaded ${loadedEnvFiles.map((filePath) => path.basename(filePath)).join(', ')}`
      : '[env] no env file found, using process environment only',
  );

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
