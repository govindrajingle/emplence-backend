'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

// Loads .env.local / .env (or ENV_FILE) before the database configuration is read.
require('../config/env');

const { closePool, getPool, withTransaction } = require('../config/db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const MIGRATIONS_TABLE = 'schema_migrations';

/** Bookkeeping table that records which migration files already ran. */
const ensureMigrationsTable = async () => {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

const getAppliedMigrations = async () => {
  const { rows } = await getPool().query(`SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name`);
  return new Set(rows.map((row) => row.name));
};

/** Migration files run in lexicographic order, so keep the numeric prefixes. */
const getMigrationFiles = async () => {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith('.sql')).sort();
};

const run = async () => {
  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();
  const files = await getMigrationFiles();
  let appliedCount = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[migrate] skip    ${file} (already applied)`);
      continue;
    }

    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');

    // Each migration is atomic: the schema change and its bookkeeping row commit together.
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)`, [file]);
    });

    console.log(`[migrate] applied ${file}`);
    appliedCount += 1;
  }

  console.log(
    appliedCount === 0
      ? '[migrate] database is up to date'
      : `[migrate] ${appliedCount} migration(s) applied`,
  );
};

run()
  .then(() => closePool())
  .catch(async (error) => {
    console.error(`[migrate] failed: ${error.message}`);
    await closePool();
    process.exit(1);
  });
