'use strict';

const bcrypt = require('bcryptjs');

const { getPool, withTransaction } = require('../config/db');
const { createAppError, mapDatabaseError } = require('../utils/errors');

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

const validateCredentials = ({ username, password }) => {
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
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw createAppError(400, `password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw createAppError(400, `password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
  }

  return name;
};

/**
 * Registers a user with a hashed password.
 *
 * The role is resolved server-side (EMPLOYEE) and cannot be supplied by the
 * caller, so public registration can never create an Administrator.
 * Company/location are optional, but a location is only accepted when it
 * belongs to the supplied company.
 */
const register = async ({ username, password, companyId, locationId }) => {
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
      const role = await client.query(
        'SELECT id FROM master_roles WHERE role_code = $1 AND is_valid = TRUE',
        [PUBLIC_REGISTRATION_ROLE_CODE],
      );

      if (role.rowCount === 0) {
        throw createAppError(
          500,
          `Default role "${PUBLIC_REGISTRATION_ROLE_CODE}" is missing; run \`npm run db:seed\`.`,
        );
      }

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
        [name, passwordHash, role.rows[0].id, company, location],
      );

      return rows[0];
    });
  } catch (error) {
    throw mapDatabaseError(error, {
      unique: `Username "${name}" is already taken.`,
    });
  }
};

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
  const { rows } = await getPool().query(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );

  return rows[0] ?? null;
};

module.exports = {
  PUBLIC_REGISTRATION_ROLE_CODE,
  register,
  findByUsername,
  findById,
};
