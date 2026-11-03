'use strict';

const { getPool } = require('../config/db');
const { createAppError, mapDatabaseError } = require('../utils/errors');

/** Model for `master_companies`: parent table of locations and users. */

const COMPANY_COLUMNS = 'id, company_name, company_code, is_valid, dt_entry_date';

const validateInput = ({ companyName, companyCode }) => {
  const name = typeof companyName === 'string' ? companyName.trim() : '';
  const code = typeof companyCode === 'string' ? companyCode.trim() : '';

  if (!name) {
    throw createAppError(400, 'companyName is required.');
  }
  if (name.length > 255) {
    throw createAppError(400, 'companyName must be at most 255 characters.');
  }
  if (!code) {
    throw createAppError(400, 'companyCode is required.');
  }
  if (code.length > 50) {
    throw createAppError(400, 'companyCode must be at most 50 characters.');
  }

  return { name, code };
};

/** Inserts a company. `company_code` is validated by a UNIQUE constraint. */
const create = async ({ companyName, companyCode }) => {
  const { name, code } = validateInput({ companyName, companyCode });

  try {
    const { rows } = await getPool().query(
      `INSERT INTO master_companies (company_name, company_code)
       VALUES ($1, $2)
       RETURNING ${COMPANY_COLUMNS}`,
      [name, code],
    );

    return rows[0];
  } catch (error) {
    throw mapDatabaseError(error, { unique: `Company code "${code}" already exists.` });
  }
};

const findById = async (id) => {
  const { rows } = await getPool().query(
    `SELECT ${COMPANY_COLUMNS} FROM master_companies WHERE id = $1`,
    [id],
  );

  return rows[0] ?? null;
};

const findByCode = async (companyCode) => {
  const code = typeof companyCode === 'string' ? companyCode.trim() : '';
  const { rows } = await getPool().query(
    `SELECT ${COMPANY_COLUMNS} FROM master_companies WHERE company_code = $1`,
    [code],
  );

  return rows[0] ?? null;
};

const findAll = async ({ includeInvalid = false } = {}) => {
  const { rows } = await getPool().query(
    `SELECT ${COMPANY_COLUMNS}
       FROM master_companies
      ${includeInvalid ? '' : 'WHERE is_valid = TRUE'}
      ORDER BY company_name`,
  );

  return rows;
};

module.exports = { create, findById, findByCode, findAll };
