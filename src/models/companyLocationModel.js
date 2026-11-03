'use strict';

const { getPool, withTransaction } = require('../config/db');
const { createAppError, mapDatabaseError } = require('../utils/errors');
const { hasOwn, parseBoolean, parseId, parseRequiredText } = require('../utils/validation');

/**
 * Model for `companies_locations` (branches/offices/premises of a company).
 * The parent company is validated before inserting so callers get a clear
 * message instead of a raw foreign key violation.
 */

const LOCATION_COLUMNS = 'id, company_id, location_name, location_code, is_valid, dt_entry_date';

const parseCompanyId = (value) => {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createAppError(400, 'companyId must be a positive integer.');
  }

  return id;
};

const validateInput = ({ locationName, locationCode }) => {
  const name = typeof locationName === 'string' ? locationName.trim() : '';
  const code = typeof locationCode === 'string' ? locationCode.trim() : '';

  if (!name) {
    throw createAppError(400, 'locationName is required.');
  }
  if (name.length > 255) {
    throw createAppError(400, 'locationName must be at most 255 characters.');
  }
  if (!code) {
    throw createAppError(400, 'locationCode is required.');
  }
  if (code.length > 50) {
    throw createAppError(400, 'locationCode must be at most 50 characters.');
  }

  return { name, code };
};

/** Creates a location for an existing, valid company inside one transaction. */
const create = async ({ companyId, locationName, locationCode }) => {
  const id = parseCompanyId(companyId);
  const { name, code } = validateInput({ locationName, locationCode });

  try {
    return await withTransaction(async (client) => {
      const company = await client.query(
        'SELECT id FROM master_companies WHERE id = $1 AND is_valid = TRUE',
        [id],
      );

      if (company.rowCount === 0) {
        throw createAppError(400, `Company ${id} does not exist or is not valid.`);
      }

      const { rows } = await client.query(
        `INSERT INTO companies_locations (company_id, location_name, location_code)
         VALUES ($1, $2, $3)
         RETURNING ${LOCATION_COLUMNS}`,
        [id, name, code],
      );

      return rows[0];
    });
  } catch (error) {
    throw mapDatabaseError(error, {
      unique: `Location code "${code}" already exists for this company.`,
    });
  }
};

const findById = async (id) => {
  const { rows } = await getPool().query(
    `SELECT ${LOCATION_COLUMNS} FROM companies_locations WHERE id = $1`,
    [id],
  );

  return rows[0] ?? null;
};

const findByCompanyAndCode = async ({ companyId, locationCode }) => {
  const id = parseCompanyId(companyId);
  const code = typeof locationCode === 'string' ? locationCode.trim() : '';

  const { rows } = await getPool().query(
    `SELECT ${LOCATION_COLUMNS}
       FROM companies_locations
      WHERE company_id = $1 AND location_code = $2`,
    [id, code],
  );

  return rows[0] ?? null;
};

const findByCompanyId = async (companyId, { includeInvalid = false } = {}) => {
  const id = parseCompanyId(companyId);

  const { rows } = await getPool().query(
    `SELECT ${LOCATION_COLUMNS}
       FROM companies_locations
      WHERE company_id = $1
      ${includeInvalid ? '' : 'AND is_valid = TRUE'}
      ORDER BY location_name`,
    [id],
  );

  return rows;
};

/** All locations, optionally filtered by company. */
const findAll = async ({ companyId, includeInvalid = false } = {}) => {
  const filters = [];
  const values = [];

  if (companyId !== undefined && companyId !== null && companyId !== '') {
    values.push(parseCompanyId(companyId));
    filters.push(`company_id = $${values.length}`);
  }
  if (!includeInvalid) {
    filters.push('is_valid = TRUE');
  }

  const { rows } = await getPool().query(
    `SELECT ${LOCATION_COLUMNS}
       FROM companies_locations
      ${filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY location_name`,
    values,
  );

  return rows;
};

/**
 * Partial update of a location.
 *
 * `company_id` is intentionally immutable: users may already reference this
 * location, and moving it to another company would break the
 * "location belongs to company" invariant. Create a new location instead.
 */
const update = async (id, changes = {}) => {
  const locationId = parseId(id, 'locationId');
  const assignments = [];
  const values = [];

  const set = (column, value) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  if (hasOwn(changes, 'companyId')) {
    throw createAppError(
      400,
      'companyId cannot be changed; create a new location for the other company instead.',
    );
  }
  if (hasOwn(changes, 'locationName')) {
    set('location_name', parseRequiredText(changes.locationName, 'locationName', 255));
  }
  if (hasOwn(changes, 'locationCode')) {
    set('location_code', parseRequiredText(changes.locationCode, 'locationCode', 50));
  }
  if (hasOwn(changes, 'isValid')) {
    set('is_valid', parseBoolean(changes.isValid, 'isValid'));
  }

  if (assignments.length === 0) {
    throw createAppError(400, 'Provide at least one of: locationName, locationCode, isValid.');
  }

  values.push(locationId);

  try {
    const { rows } = await getPool().query(
      `UPDATE companies_locations
          SET ${assignments.join(', ')}
        WHERE id = $${values.length}
        RETURNING ${LOCATION_COLUMNS}`,
      values,
    );

    if (rows.length === 0) {
      throw createAppError(404, `Location ${locationId} was not found.`);
    }

    return rows[0];
  } catch (error) {
    throw mapDatabaseError(error, {
      unique: 'That location code already exists for this company.',
    });
  }
};

module.exports = { create, findById, findByCompanyAndCode, findByCompanyId, findAll, update };
