'use strict';

const locationModel = require('../models/companyLocationModel');
const {
  isGlobalActor,
  resolveTargetCompany,
  validateCompanyAccess,
} = require('../services/authorizationService');
const { createAppError } = require('../utils/errors');
const { parseOptionalBoolean } = require('../utils/validation');

/**
 * HTTP layer for `/api/companies-locations`.
 * Company users are pinned to their own company for reads and writes.
 */

/** GET /api/companies-locations?companyId=1&includeInvalid=true */
const list = async (req, res) => {
  const includeInvalid = parseOptionalBoolean(req.query.includeInvalid, 'includeInvalid');
  let companyId = req.query.companyId;

  if (!isGlobalActor(req.actor)) {
    if (companyId !== undefined && companyId !== '' && Number(companyId) !== req.actor.companyId) {
      throw createAppError(403, 'You can only access locations of your own company.');
    }
    companyId = req.actor.companyId;
  }

  const locations = await locationModel.findAll({ companyId, includeInvalid });

  res.status(200).json({ count: locations.length, data: locations });
};

/** POST /api/companies-locations — company is forced to the caller's company. */
const create = async (req, res) => {
  const body = req.body ?? {};
  const companyId = resolveTargetCompany(req.actor, body.companyId);

  if (companyId === undefined || companyId === null || companyId === '') {
    throw createAppError(400, 'companyId is required.');
  }

  const location = await locationModel.create({
    companyId,
    locationName: body.locationName,
    locationCode: body.locationCode,
  });

  res.status(201).json({ data: location });
};

/** PUT /api/companies-locations/:id — only locations of the caller's company. */
const update = async (req, res) => {
  const existing = await locationModel.findById(req.params.id);

  if (!existing) {
    throw createAppError(404, `Location ${req.params.id} was not found.`);
  }

  validateCompanyAccess(req.actor, existing.company_id);

  const location = await locationModel.update(existing.id, req.body ?? {});

  res.status(200).json({ data: location });
};

module.exports = { list, create, update };
