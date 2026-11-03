'use strict';

const { getPool, withTransaction } = require('../config/db');

/**
 * Model for `master_roles`.
 *
 * Roles are managed by backend code only - there is deliberately no create/
 * update/delete API surface here. New roles are added by a migration (or an
 * admin-only internal flow) so clients can never create roles.
 */

const ROLE_COLUMNS = 'id, role_name, role_code, is_valid, dt_entry_date';

/** Roles the application depends on; seeded idempotently on every start. */
const DEFAULT_ROLES = [
  { roleName: 'Administrator', roleCode: 'ADMIN' },
  { roleName: 'Employee', roleCode: 'EMPLOYEE' },
];

/**
 * Inserts the default roles if they are missing.
 * `ON CONFLICT (role_code) DO NOTHING` makes repeated calls (and app restarts)
 * safe: existing rows are never duplicated or overwritten.
 *
 * @returns {Promise<{ inserted: string[] }>} role codes that were actually created
 */
const ensureDefaultRoles = () =>
  withTransaction(async (client) => {
    const inserted = [];

    for (const role of DEFAULT_ROLES) {
      const { rows } = await client.query(
        `INSERT INTO master_roles (role_name, role_code)
         VALUES ($1, $2)
         ON CONFLICT (role_code) DO NOTHING
         RETURNING role_code`,
        [role.roleName, role.roleCode],
      );

      if (rows.length > 0) {
        inserted.push(rows[0].role_code);
      }
    }

    return { inserted };
  });

const findAll = async ({ includeInvalid = false } = {}) => {
  const { rows } = await getPool().query(
    `SELECT ${ROLE_COLUMNS}
       FROM master_roles
      ${includeInvalid ? '' : 'WHERE is_valid = TRUE'}
      ORDER BY role_name`,
  );

  return rows;
};

const findById = async (id) => {
  const { rows } = await getPool().query(
    `SELECT ${ROLE_COLUMNS} FROM master_roles WHERE id = $1`,
    [id],
  );

  return rows[0] ?? null;
};

const findByCode = async (roleCode) => {
  const code = typeof roleCode === 'string' ? roleCode.trim() : '';
  const { rows } = await getPool().query(
    `SELECT ${ROLE_COLUMNS} FROM master_roles WHERE role_code = $1`,
    [code],
  );

  return rows[0] ?? null;
};

module.exports = { DEFAULT_ROLES, ensureDefaultRoles, findAll, findById, findByCode };
