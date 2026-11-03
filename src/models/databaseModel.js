'use strict';

const { getPool } = require('../config/db');

/**
 * Model layer: the only place that talks to PostgreSQL.
 * This model intentionally performs a read-only connection test (no tables are
 * created) because data access is outside the current scope.
 */

/** Runs a lightweight query and returns basic server information. */
const ping = async () => {
  const { rows } = await getPool().query(
    'SELECT version() AS version, current_database() AS database',
  );

  return rows[0];
};

module.exports = { ping };
