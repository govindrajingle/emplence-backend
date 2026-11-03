'use strict';

const companyModel = require('../models/companyModel');
const { parseOptionalBoolean } = require('../utils/validation');

/** HTTP layer for `/api/companies`. */

/** GET /api/companies?includeInvalid=true */
const list = async (req, res) => {
  const companies = await companyModel.findAll({
    includeInvalid: parseOptionalBoolean(req.query.includeInvalid, 'includeInvalid'),
  });

  res.status(200).json({ count: companies.length, data: companies });
};

/** POST /api/companies — body: { companyName, companyCode } */
const create = async (req, res) => {
  const body = req.body ?? {};

  const company = await companyModel.create({
    companyName: body.companyName,
    companyCode: body.companyCode,
  });

  res.status(201).json({ data: company });
};

/** PUT /api/companies/:id — body: any of { companyName, companyCode, isValid } */
const update = async (req, res) => {
  const company = await companyModel.update(req.params.id, req.body ?? {});

  res.status(200).json({ data: company });
};

module.exports = { list, create, update };
