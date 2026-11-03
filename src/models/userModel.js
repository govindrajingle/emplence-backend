'use strict';

const bcrypt = require('bcryptjs');

const { getPool, withTransaction } = require('../config/db');
const { createAppError, mapDatabaseError } = require('../utils/errors');
const { hasOwn, parseBoolean, parseId } = require('../utils/validation');

/**
 * Model for `users`.
 *
 * Password hashing and role assignment live here, not in the controllers, so
 * every write path stores a hash and a backend-chosen role.
 */

// Only non-sensitive columns are ever returned to callers.
const USER_COLUMNS = 'id, username, role_id, company_id, location_id, is_valid, dt_entry_date';

/** Public registration always gets this role; ADMIN can never be self-assigned. */
const PUBLIC_REGISTRATION_ROLE_CODE = 'EMPLOYEE';

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS) || 10;
const MIN_PASSWORD_LENGTH = 8;
// bcrypt only uses the first 72 bytes of input.
const MAX_PASSWORD_LENGTH = 72;
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 100;

const parseOptionalId = (value, field) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createAppError(400, `${field} must be a positive integer.`);
  }

  return id;
};

const validateUsername = (username) => {
  const name = typeof username === 'string' ? username.trim() : '';

  if (!name) {
    throw createAppError(400, 'username is required.');
  }
  if (name.length < MIN_USERNAME_LENGTH || name.length > MAX_USERNAME_LENGTH) {
    throw createAppError(
      400,
      `username must be between ${MIN_USERNAME_LENGTH} and ${MAX_USERNAME_LENGTH} characters.`,
    );
  }

  return name;
};

const validatePassword = (password) => {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw createAppError(400, `password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw createAppError(400, `password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
  }

  return password;
};

const validateCredentials = ({ username, password }) => {
  const name = validateUsername(username);
  validatePassword(password);

  return name;
};

/** Resolves a role id by code inside an open transaction. */
const resolveRoleId = async (client, roleCode) => {
  const code =
    typeof roleCode === 'string' && roleCode.trim()
      ? roleCode.trim().toUpperCase()
      : PUBLIC_REGISTRATION_ROLE_CODE;

  const { rows } = await client.query(
    'SELECT id FROM master_roles WHERE role_code = $1 AND is_valid = TRUE',
    [code],
  );

  if (rows.length === 0) {
    throw createAppError(400, `Role "${code}" does not exist or is not valid.`);
  }

  return rows[0].id;
};

/**
 * Creates a user with a hashed password.
 *
 * `roleCode` defaults to EMPLOYEE. Assigning any other role is privileged and
 * the HTTP layer requires the ADMIN_API_KEY header for it.
 * Company/location are optional, but a location is only accepted when it
 * belongs to the supplied company.
 */
const create = async ({ username, password, roleCode, companyId, locationId }) => {
  const name = validateCredentials({ username, password });
  const company = parseOptionalId(companyId, 'companyId');
  const location = parseOptionalId(locationId, 'locationId');

  if (location !== null && company === null) {
    throw createAppError(400, 'locationId requires companyId.');
  }

  // Hash before opening the transaction so the connection is not held during hashing.
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    return await withTransaction(async (client) => {
      const roleId = await resolveRoleId(client, roleCode);

      if (company !== null) {
        const companyRow = await client.query(
          'SELECT id FROM master_companies WHERE id = $1 AND is_valid = TRUE',
          [company],
        );

        if (companyRow.rowCount === 0) {
          throw createAppError(400, `Company ${company} does not exist or is not valid.`);
        }
      }

      if (location !== null) {
        const locationRow = await client.query(
          `SELECT id
             FROM companies_locations
            WHERE id = $1 AND company_id = $2 AND is_valid = TRUE`,
          [location, company],
        );

        if (locationRow.rowCount === 0) {
          throw createAppError(
            400,
            `Location ${location} does not belong to company ${company} or is not valid.`,
          );
        }
      }

      const { rows } = await client.query(
        `INSERT INTO users (username, password, role_id, company_id, location_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${USER_COLUMNS}`,
        [name, passwordHash, roleId, company, location],
      );

      return rows[0];
    });
  } catch (error) {
    throw mapDatabaseError(error, {
      unique: `Username "${name}" is already taken.`,
    });
  }
};

/**
 * Public self-registration: the role is always EMPLOYEE and cannot be supplied
 * by the caller, so nobody can grant themselves ADMIN.
 */
const register = async ({ username, password, companyId, locationId }) =>
  create({
    username,
    password,
    roleCode: PUBLIC_REGISTRATION_ROLE_CODE,
    companyId,
    locationId,
  });

/** Case-insensitive lookup without exposing the password hash. */
const findByUsername = async (username) => {
  const name = typeof username === 'string' ? username.trim() : '';

  if (!name) {
    throw createAppError(400, 'username is required.');
  }

  const { rows } = await getPool().query(
    `SELECT ${USER_COLUMNS}
       FROM users
      WHERE lower(username) = lower($1) AND is_valid = TRUE`,
    [name],
  );

  return rows[0] ?? null;
};

const findById = async (id) => {
  const userId = parseId(id, 'userId');

  const { rows } = await getPool().query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [
    userId,
  ]);

  return rows[0] ?? null;
};

const USER_LIST_COLUMNS =
  'u.id, u.username, u.role_id, r.role_code, u.company_id, u.location_id, u.is_valid, u.dt_entry_date';

/** Users with their role code, optionally filtered by company/location. */
const findAll = async ({ companyId, locationId, includeInvalid = false } = {}) => {
  const filters = [];
  const values = [];

  if (companyId !== undefined && companyId !== null && companyId !== '') {
    values.push(parseId(companyId, 'companyId'));
    filters.push(`u.company_id = $${values.length}`);
  }
  if (locationId !== undefined && locationId !== null && locationId !== '') {
    values.push(parseId(locationId, 'locationId'));
    filters.push(`u.location_id = $${values.length}`);
  }
  if (!includeInvalid) {
    filters.push('u.is_valid = TRUE');
  }

  const { rows } = await getPool().query(
    `SELECT ${USER_LIST_COLUMNS}
       FROM users u
       JOIN master_roles r ON r.id = u.role_id
      ${filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY u.username`,
    values,
  );

  return rows;
};

/**
 * Partial update of a user inside one transaction.
 *
 * Foreign keys are validated before writing:
 * - `roleCode` must resolve to an existing, valid role (ADMIN assignment is
 *   guarded by the HTTP layer, not here).
 * - `companyId` must exist and be valid when supplied.
 * - `locationId` must belong to the effective company (new or existing one).
 * The password is re-hashed whenever it is supplied.
 */
const update = async (id, changes = {}) => {
  const userId = parseId(id, 'userId');
  const passwordHash = hasOwn(changes, 'password')
    ? await bcrypt.hash(validatePassword(changes.password), BCRYPT_ROUNDS)
    : null;

  try {
    return await withTransaction(async (client) => {
      const existing = await client.query(
        'SELECT company_id, location_id FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      );

      if (existing.rowCount === 0) {
        throw createAppError(404, `User ${userId} was not found.`);
      }

      const assignments = [];
      const values = [];
      const set = (column, value) => {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      };

      if (hasOwn(changes, 'username')) {
        set('username', validateUsername(changes.username));
      }
      if (passwordHash !== null) {
        set('password', passwordHash);
      }
      if (hasOwn(changes, 'isValid')) {
        set('is_valid', parseBoolean(changes.isValid, 'isValid'));
      }
      if (hasOwn(changes, 'roleCode')) {
        set('role_id', await resolveRoleId(client, changes.roleCode));
      }

      const companyProvided = hasOwn(changes, 'companyId');
      const locationProvided = hasOwn(changes, 'locationId');

      if (companyProvided || locationProvided) {
        const nextCompany = companyProvided
          ? parseOptionalId(changes.companyId, 'companyId')
          : existing.rows[0].company_id;
        const nextLocation = locationProvided
          ? parseOptionalId(changes.locationId, 'locationId')
          : existing.rows[0].location_id;

        if (nextLocation !== null && nextCompany === null) {
          throw createAppError(400, 'locationId requires companyId.');
        }

        if (nextCompany !== null) {
          const companyRow = await client.query(
            'SELECT id FROM master_companies WHERE id = $1 AND is_valid = TRUE',
            [nextCompany],
          );

          if (companyRow.rowCount === 0) {
            throw createAppError(400, `Company ${nextCompany} does not exist or is not valid.`);
          }
        }

        if (nextLocation !== null) {
          const locationRow = await client.query(
            `SELECT id
               FROM companies_locations
              WHERE id = $1 AND company_id = $2 AND is_valid = TRUE`,
            [nextLocation, nextCompany],
          );

          if (locationRow.rowCount === 0) {
            throw createAppError(
              400,
              `Location ${nextLocation} does not belong to company ${nextCompany} or is not valid.`,
            );
          }
        }

        if (companyProvided) {
          set('company_id', nextCompany);
        }
        if (locationProvided) {
          set('location_id', nextLocation);
        }
      }

      if (assignments.length === 0) {
        throw createAppError(
          400,
          'Provide at least one of: username, password, roleCode, companyId, locationId, isValid.',
        );
      }

      values.push(userId);

      const { rows } = await client.query(
        `UPDATE users
            SET ${assignments.join(', ')}
          WHERE id = $${values.length}
          RETURNING ${USER_COLUMNS}`,
        values,
      );

      return rows[0];
    });
  } catch (error) {
    throw mapDatabaseError(error, { unique: 'That username is already taken.' });
  }
};

module.exports = {
  PUBLIC_REGISTRATION_ROLE_CODE,
  create,
  register,
  findByUsername,
  findById,
  findAll,
  update,
};
