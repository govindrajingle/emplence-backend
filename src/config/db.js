'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { Pool, types } = require('pg');

// node-postgres returns BIGINT (int8, OID 20) as a string to avoid precision loss.
// Identity ids stay far below Number.MAX_SAFE_INTEGER, so expose them as JSON numbers.
types.setTypeParser(types.builtins.INT8, (value) => Number(value));

// TLS is required for remotely hosted PostgreSQL. Certificate validation stays
// ON by default; only an explicit environment override can turn it off.
const DEFAULT_SSL_MODE = 'require';

const parseBoolean = (value, fallback) => {
  if (value === undefined || value === '') {
    return fallback;
  }

  const normalised = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalised)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalised)) return false;

  return fallback;
};

/**
 * Reads an optional provider CA bundle so managed databases that use a private
 * or self-signed CA can be verified instead of blindly trusted.
 * Supports an inline PEM (`DB_SSL_CA`, with `\n` escapes) or a file path.
 */
const readCaCertificate = () => {
  const inlineCa = process.env.DB_SSL_CA;
  if (inlineCa) {
    return inlineCa.replace(/\\n/g, '\n');
  }

  const caPath = process.env.DB_SSL_CA_PATH;
  if (caPath) {
    const resolvedPath = path.resolve(caPath);

    try {
      return fs.readFileSync(resolvedPath, 'utf8');
    } catch (error) {
      throw new Error(`Unable to read DB_SSL_CA_PATH at ${resolvedPath}: ${error.message}`);
    }
  }

  return undefined;
};

/**
 * Builds the `pg` TLS options from the environment.
 * `require` (default) keeps certificate validation enabled; `disable` is only
 * intended for a local PostgreSQL instance without TLS.
 */
const buildSslConfig = () => {
  const sslMode = (process.env.DB_SSL_MODE || DEFAULT_SSL_MODE).trim().toLowerCase();

  if (sslMode === 'disable') {
    return false;
  }

  if (sslMode !== 'require') {
    throw new Error(`Unsupported DB_SSL_MODE "${sslMode}". Use "require" (default) or "disable".`);
  }

  const ssl = {
    rejectUnauthorized: parseBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED, true),
  };

  const ca = readCaCertificate();
  if (ca) {
    ssl.ca = ca;
  }

  return ssl;
};

/**
 * Builds the pool configuration for the PostgreSQL 18 service URI.
 * Any `sslmode` in the URI is removed so `DB_SSL_*` remains the single source of
 * truth for TLS (in `pg`, a URI `sslmode` would otherwise override these options).
 */
const buildPoolConfig = () => {
  const rawUrl = process.env.DATABASE_URL;

  if (!rawUrl) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and provide the PostgreSQL service URI.',
    );
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL connection URI.');
  }

  url.searchParams.delete('sslmode');

  return {
    connectionString: url.toString(),
    ssl: buildSslConfig(),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 10_000,
  };
};

let pool;

/** Lazily creates the shared connection pool so configuration errors are catchable. */
const getPool = () => {
  if (pool) {
    return pool;
  }

  const config = buildPoolConfig();

  if (config.ssl && config.ssl.rejectUnauthorized === false) {
    console.warn(
      '[db] TLS certificate validation is disabled (DB_SSL_REJECT_UNAUTHORIZED=false). Use only for trusted development environments.',
    );
  }

  pool = new Pool(config);

  // Without this listener an idle client error would crash the process.
  pool.on('error', (error) => {
    console.error('[db] idle client error:', error.message);
  });

  return pool;
};

/** Human-readable TLS summary used in the startup log (never includes secrets). */
const getSslSummary = () => {
  const ssl = buildSslConfig();

  if (!ssl) {
    return 'disabled (DB_SSL_MODE=disable)';
  }

  return `enabled (rejectUnauthorized=${ssl.rejectUnauthorized}, ca=${ssl.ca ? 'custom' : 'system'})`;
};

/** Closes every pooled connection; safe to call when the pool was never created. */
const closePool = async () => {
  if (!pool) {
    return;
  }

  const openPool = pool;
  pool = undefined;
  await openPool.end();
};

/**
 * Runs `callback(client)` inside a single transaction on a dedicated pooled client.
 * Commits on success, rolls back on any error and always releases the client.
 */
const withTransaction = async (callback) => {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { getPool, getSslSummary, closePool, withTransaction };
