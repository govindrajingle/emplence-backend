'use strict';

const { getPool, withTransaction } = require('../config/db');
const { createAppError, mapDatabaseError } = require('../utils/errors');
const { hasOwn, parseBoolean, parseId, parseRequiredText } = require('../utils/validation');

/**
 * Model for `master_roles`.
 *
 * Roles are either global (`company_id IS NULL`, seeded: ADMIN and EMPLOYEE) or
 * owned by one company (created by that company's sub-admin). `hierarchy_level`
 * orders them: lower value = higher authority, and an actor can only grant
 * levels greater than its own.
 */

const ROLE_COLUMNS =
  'id, role_name, role_code, company_id, hierarchy_level, is_valid, dt_entry_date';

/** Roles the application depends on; seeded idempotently on every start. */
const DEFAULT_ROLES = [
  { roleName: 'Administrator', roleCode: 'ADMIN', hierarchyLevel: 1 },
  { roleName: 'Employee', roleCode: 'EMPLOYEE', hierarchyLevel: 100 },
];

/**
 * Inserts the default global roles if they are missing.
 * `ON CONFLICT (company_id, role_code) DO NOTHING` (NULLS NOT DISTINCT) makes
 * repeated calls and app restarts safe: existing rows are never duplicated.
 *
 * @returns {Promise<{ inserted: string[] }>} role codes that were actually created
 */
const ensureDefaultRoles = () =>
  withTransaction(async (client) => {
    const inserted = [];

    for (const role of DEFAULT_ROLES) {
      const { rows } = await client.query(
        `INSERT INTO master_roles (role_name, role_code, company_id, hierarchy_level)
         VALUES ($1, $2, NULL, $3)
         ON CONFLICT (company_id, role_code) DO NOTHING
         RETURNING role_code`,
        [role.roleName, role.roleCode, role.hierarchyLevel],
      );

      if (rows.length > 0) {
        inserted.push(rows[0].role_code);
      }
    }

    return { inserted };
  });

/**
 * Lists roles.
 * - `companyId` omitted → every role (global actors).
 * - `companyId` given   → global roles plus that company's roles.
 */
const findAll = async ({ companyId, includeInvalid = false } = {}) => {
  const filters = [];
  const values = [];

  if (companyId !== undefined && companyId !== null && companyId !== '') {
    values.push(parseId(companyId, 'companyId'));
    filters.push(`(company_id IS NULL OR company_id = $${values.length})`);
  }
  if (!includeInvalid) {
    filters.push('is_valid = TRUE');
  }

  const { rows } = await getPool().query(
    `SELECT ${ROLE_COLUMNS}
       FROM master_roles
      ${filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY hierarchy_level, role_name`,
    values,
  );

  return rows;
};

const findById = async (id) => {
  const roleId = parseId(id, 'roleId');

  const { rows } = await getPool().query(
    `SELECT ${ROLE_COLUMNS} FROM master_roles WHERE id = $1`,
    [roleId],
  );

  return rows[0] ?? null;
};

/**
 * Resolves a role code within a company scope.
 * Company-specific roles win over global ones with the same code; when
 * `companyId` is null only global roles are considered.
 */
const findByCode = async (roleCode, { companyId = null } = {}) => {
  const code = typeof roleCode === 'string' ? roleCode.trim().toUpperCase() : '';
  const values = [code];
  let companyFilter = 'company_id IS NULL';

  if (companyId !== null && companyId !== undefined && companyId !== '') {
    values.push(parseId(companyId, 'companyId'));
    companyFilter = `(company_id IS NULL OR company_id = $${values.length})`;
  }

  const { rows } = await getPool().query(
    `SELECT ${ROLE_COLUMNS}
       FROM master_roles
      WHERE role_code = $1 AND ${companyFilter}
      ORDER BY company_id NULLS LAST
      LIMIT 1`,
    values,
  );

  return rows[0] ?? null;
};

const parseHierarchyLevel = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const level = Number(value);

  if (!Number.isSafeInteger(level) || level <= 0) {
    throw createAppError(400, 'hierarchyLevel must be a positive integer.');
  }

  return level;
};

/**
 * Creates a role, either global (`companyId = null`) or owned by a company.
 * `(company_id, role_code)` must be unique (enforced by the database).
 */
const create = async ({ roleName, roleCode, companyId = null, hierarchyLevel }) => {
  const name = parseRequiredText(roleName, 'roleName', 100);
  const code = parseRequiredText(roleCode, 'roleCode', 50).toUpperCase();
  const company = companyId === undefined || companyId === null || companyId === ''
    ? null
    : parseId(companyId, 'companyId');
  const level = parseHierarchyLevel(hierarchyLevel, 100);

  try {
    return await withTransaction(async (client) => {
      if (company !== null) {
        const companyRow = await client.query(
          'SELECT id FROM master_companies WHERE id = $1 AND is_valid = TRUE',
          [company],
        );

        if (companyRow.rowCount === 0) {
          throw createAppError(400, `Company ${company} does not exist or is not valid.`);
        }
      }

      const { rows } = await client.query(
        `INSERT INTO master_roles (role_name, role_code, company_id, hierarchy_level)
         VALUES ($1, $2, $3, $4)
         RETURNING ${ROLE_COLUMNS}`,
        [name, code, company, level],
      );

      return rows[0];
    });
  } catch (error) {
    throw mapDatabaseError(error, {
      unique: `Role code "${code}" already exists for this scope.`,
    });
  }
};

/**
 * Partial update of a role. `company_id` is immutable (moving a role between
 * companies would silently change who can use it).
 */
const update = async (id, changes = {}) => {
  const roleId = parseId(id, 'roleId');
  const assignments = [];
  const values = [];

  const set = (column, value) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  if (hasOwn(changes, 'companyId')) {
    throw createAppError(400, 'companyId cannot be changed on an existing role.');
  }
  if (hasOwn(changes, 'roleName')) {
    set('role_name', parseRequiredText(changes.roleName, 'roleName', 100));
  }
  if (hasOwn(changes, 'roleCode')) {
    set('role_code', parseRequiredText(changes.roleCode, 'roleCode', 50).toUpperCase());
  }
  if (hasOwn(changes, 'hierarchyLevel')) {
    set('hierarchy_level', parseHierarchyLevel(changes.hierarchyLevel, 100));
  }
  if (hasOwn(changes, 'isValid')) {
    set('is_valid', parseBoolean(changes.isValid, 'isValid'));
  }

  if (assignments.length === 0) {
    throw createAppError(
      400,
      'Provide at least one of: roleName, roleCode, hierarchyLevel, isValid.',
    );
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
    throw mapDatabaseError(error, { unique: 'That role code is already in use for this scope.' });
  }
};

module.exports = {
  DEFAULT_ROLES,
  ensureDefaultRoles,
  findAll,
  findById,
  findByCode,
  create,
  update,
};
