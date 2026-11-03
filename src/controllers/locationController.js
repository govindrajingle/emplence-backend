'use strict';

const locationModel = require('../models/companyLocationModel');
const { parseOptionalBoolean } = require('../utils/validation');

/** HTTP layer for `/api/companies-locations`. */

/** GET /api/companies-locations?companyId=1&includeInvalid=true */
const list = async (req, res) => {
  const locations = await locationModel.findAll({
    companyId: req.query.companyId,
    includeInvalid: parseOptionalBoolean(req.query.includeInvalid, 'includeInvalid'),
  });

  res.status(200).json({ count: locations.length, data: locations });
};

/** POST /api/companies-locations — body: { companyId, locationName, locationCode } */
const create = async (req, res) => {
  const body = req.body ?? {};

  const location = await locationModel.create({
    companyId: body.companyId,
    locationName: body.locationName,
    locationCode: body.locationCode,
  });

  res.status(201).json({ data: location });
};

/** PUT /api/companies-locations/:id — body: any of { locationName, locationCode, isValid } */
const update = async (req, res) => {
  const location = await locationModel.update(req.params.id, req.body ?? {});

  res.status(200).json({ data: location });
};

module.exports = { list, create, update };
