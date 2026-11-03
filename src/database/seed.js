'use strict';

// Loads .env.local / .env (or ENV_FILE) before the database configuration is read.
require('../config/env');

const { closePool } = require('../config/db');
const roleModel = require('../models/roleModel');

/**
 * Seeds the master data the application depends on (default roles).
 * Safe to run repeatedly: existing roles are never duplicated.
 */
const run = async () => {
  const { inserted } = await roleModel.ensureDefaultRoles();

  console.log(
    inserted.length > 0
      ? `[seed] inserted default roles: ${inserted.join(', ')}`
      : '[seed] default roles already present',
  );
};

run()
  .then(() => closePool())
  .catch(async (error) => {
    console.error(`[seed] failed: ${error.message}`);
    await closePool();
    process.exit(1);
  });
