'use strict';

const companyModel = require('../models/companyModel');
const { assertPlatformAdministrator, isGlobalActor } = require('../services/authorizationService');
const { parseOptionalBoolean } = require('../utils/validation');

/**
 * HTTP layer for `/api/companies`.
 *
 * Company users (sub-admins) can only read their own company; creating or
 * editing company master records stays with the platform administrator.
 */

/** GET /api/companies?includeInvalid=true */
const list = async (req, res) => {
  const includeInvalid = parseOptionalBoolean(req.query.includeInvalid, 'includeInvalid');

  if (isGlobalActor(req.actor)) {
    const companies = await companyModel.findAll({ includeInvalid });
    return res.status(200).json({ count: companies.length, data: companies });
  }

  const company = await companyModel.findById(req.actor.companyId);

  if (!company || (!includeInvalid && !company.is_valid)) {
    return res.status(200).json({ count: 0, data: [] });
  }

  return res.status(200).json({ count: 1, data: [company] });
};

/** POST /api/companies — platform administrator only. */
const create = async (req, res) => {
  assertPlatformAdministrator(req.actor);

  const body = req.body ?? {};

  const company = await companyModel.create({
    companyName: body.companyName,
    companyCode: body.companyCode,
  });

  res.status(201).json({ data: company });
};

/** PUT /api/companies/:id — platform administrator only. */
const update = async (req, res) => {
  assertPlatformAdministrator(req.actor);

  const company = await companyModel.update(req.params.id, req.body ?? {});

  res.status(200).json({ data: company });
};

module.exports = { list, create, update };
