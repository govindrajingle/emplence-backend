'use strict';

const { getPool, withTransaction } = require('../config/db');
const { createAppError, mapDatabaseError } = require('../utils/errors');
const { hasOwn, parseBoolean, parseId, parseRequiredText } = require('../utils/validation');

/**
 * Model for `master_roles`.
 *
 * Roles are managed by backend code only: the HTTP routes that reach `create`/
 * `update` are protected by the ADMIN_API_KEY guard. New default roles should
 * still be introduced through a migration so every environment gets them.
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

/** Creates a role. `role_code` must be unique (enforced by the database). */
const create = async ({ roleName, roleCode }) => {
  const name = parseRequiredText(roleName, 'roleName', 100);
  const code = parseRequiredText(roleCode, 'roleCode', 50);

  try {
    const { rows } = await getPool().query(
      `INSERT INTO master_roles (role_name, role_code)
       VALUES ($1, $2)
       RETURNING ${ROLE_COLUMNS}`,
      [name, code],
    );

    return rows[0];
  } catch (error) {
    throw mapDatabaseError(error, { unique: `Role code "${code}" already exists.` });
  }
};

/** Partial update of a role; the role code stays unique via its constraint. */
const update = async (id, changes = {}) => {
  const roleId = parseId(id, 'roleId');
  const assignments = [];
  const values = [];

  const set = (column, value) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  if (hasOwn(changes, 'roleName')) {
    set('role_name', parseRequiredText(changes.roleName, 'roleName', 100));
  }
  if (hasOwn(changes, 'roleCode')) {
    set('role_code', parseRequiredText(changes.roleCode, 'roleCode', 50));
  }
  if (hasOwn(changes, 'isValid')) {
    set('is_valid', parseBoolean(changes.isValid, 'isValid'));
  }

  if (assignments.length === 0) {
    throw createAppError(400, 'Provide at least one of: roleName, roleCode, isValid.');
  }

  values.push(roleId);

  try {
    const { rows } = await getPool().query(
      `UPDATE master_roles
          SET ${assignments.join(', ')}
        WHERE id = $${values.length}
        RETURNING ${ROLE_COLUMNS}`,
      values,
    );

    if (rows.length === 0) {
      throw createAppError(404, `Role ${roleId} was not found.`);
    }

    return rows[0];
  } catch (error) {
    throw mapDatabaseError(error, { unique: 'That role code is already in use.' });
  }
};

module.exports = { DEFAULT_ROLES, ensureDefaultRoles, findAll, findById, findByCode, create, update };
