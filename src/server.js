'use strict';

const os = require('node:os');
const path = require('node:path');

// Loads .env.local / .env (or ENV_FILE) before any other module reads configuration.
const { loadedEnvFiles } = require('./config/env');

const app = require('./app');
const { closePool, getSslSummary } = require('./config/db');
const databaseModel = require('./models/databaseModel');

const PORT = Number(process.env.PORT) || 3000;

// Unset binds to all interfaces (also reachable from phones on the same Wi-Fi).
// Set SERVER_HOST=127.0.0.1 to keep the API on this machine only.
const SERVER_HOST = process.env.SERVER_HOST;

let server;

/** IPv4 addresses of this machine, used to log phone-accessible URLs. */
const getLanUrls = (port) => {
  const urls = [];

  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        urls.push(`http://${address.address}:${port}`);
      }
    }
  }

  return urls;
};

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

  const listenOptions = { port: PORT };
  if (SERVER_HOST) {
    listenOptions.host = SERVER_HOST;
  }

  server = app.listen(listenOptions, () => {
    console.log(`[server] listening on http://localhost:${PORT} (bind: ${SERVER_HOST || 'all interfaces'})`);

    if (!SERVER_HOST || SERVER_HOST === '0.0.0.0' || SERVER_HOST === '::') {
      const lanUrls = getLanUrls(PORT);
      if (lanUrls.length > 0) {
        console.log(`[server] reachable on your network: ${lanUrls.join(', ')}`);
      }
    }
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
