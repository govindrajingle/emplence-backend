'use strict';

const { getPool, withTransaction } = require('../config/db');
const { createAppError } = require('../utils/errors');
const { parseId } = require('../utils/validation');

/**
 * Model for `role_permissions` (permission grants per role).
 *
 * Permissions answer "what may this role do"; `master_roles.hierarchy_level`
 * answers "who may it act upon". They are evaluated independently.
 */

const PERMISSION_COLUMNS = 'id, role_id, permission_code, is_valid, dt_entry_date';
const PERMISSION_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,99}$/;

const normalizePermissionCode = (value) => {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';

  if (!PERMISSION_CODE_PATTERN.test(code)) {
    throw createAppError(
      400,
      'permissionCode must be uppercase letters/digits/underscore, e.g. USER_CREATE.',
    );
  }

  return code;
};

const findByRoleId = async (roleId, { includeInvalid = false } = {}) => {
  const id = parseId(roleId, 'roleId');

  const { rows } = await getPool().query(
    `SELECT ${PERMISSION_COLUMNS}
       FROM role_permissions
      WHERE role_id = $1
      ${includeInvalid ? '' : 'AND is_valid = TRUE'}
      ORDER BY permission_code`,
    [id],
  );

  return rows;
};

/** Active permission codes for one role (used to build the authenticated actor). */
const findCodesForRole = async (roleId) => {
  const rows = await findByRoleId(roleId);

  return rows.map((row) => row.permission_code);
};

/** Map of roleId -> permission codes, for list responses. */
const listCodesByRoleIds = async (roleIds = []) => {
  const ids = roleIds.map((roleId) => parseId(roleId, 'roleId'));

  if (ids.length === 0) {
    return new Map();
  }

  const { rows } = await getPool().query(
    `SELECT role_id, permission_code
       FROM role_permissions
      WHERE role_id = ANY($1) AND is_valid = TRUE
      ORDER BY permission_code`,
    [ids],
  );

  const byRole = new Map(ids.map((id) => [id, []]));
  for (const row of rows) {
    byRole.get(row.role_id).push(row.permission_code);
  }

  return byRole;
};

/**
 * Replaces the permission set of a role inside one transaction:
 * supplied codes are (re)activated, everything else is deactivated.
 */
const setForRole = async (roleId, permissionCodes) => {
  const id = parseId(roleId, 'roleId');

  if (!Array.isArray(permissionCodes)) {
    throw createAppError(400, 'permissions must be an array of permission codes.');
  }

  const codes = [...new Set(permissionCodes.map(normalizePermissionCode))];

  return withTransaction(async (client) => {
    const role = await client.query('SELECT id FROM master_roles WHERE id = $1', [id]);

    if (role.rowCount === 0) {
      throw createAppError(404, `Role ${id} was not found.`);
    }

    // Deactivate grants that are no longer requested.
    await client.query(
      `UPDATE role_permissions
          SET is_valid = FALSE
        WHERE role_id = $1
          AND is_valid = TRUE
          AND permission_code <> ALL ($2::varchar[])`,
      [id, codes],
    );

    for (const code of codes) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_code, is_valid)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (role_id, permission_code)
         DO UPDATE SET is_valid = TRUE`,
        [id, code],
      );
    }

    // Read inside the transaction so the caller sees its own writes.
    const { rows } = await client.query(
      `SELECT permission_code
         FROM role_permissions
        WHERE role_id = $1 AND is_valid = TRUE
        ORDER BY permission_code`,
      [id],
    );

    return rows.map((row) => row.permission_code);
  });
};

module.exports = {
  findByRoleId,
  findCodesForRole,
  listCodesByRoleIds,
  setForRole,
  normalizePermissionCode,
};
