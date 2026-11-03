'use strict';

const roleModel = require('../models/roleModel');
const { parseOptionalBoolean } = require('../utils/validation');

/**
 * HTTP layer for `/api/roles`.
 *
 * POST/PUT are protected by the ADMIN_API_KEY guard in the routes, because roles
 * must be managed through backend-controlled functionality only.
 */

/** GET /api/roles?includeInvalid=true */
const list = async (req, res) => {
  const roles = await roleModel.findAll({
    includeInvalid: parseOptionalBoolean(req.query.includeInvalid, 'includeInvalid'),
  });

  res.status(200).json({ count: roles.length, data: roles });
};

/** POST /api/roles — body: { roleName, roleCode } */
const create = async (req, res) => {
  const body = req.body ?? {};

  const role = await roleModel.create({
    roleName: body.roleName,
    roleCode: body.roleCode,
  });

  res.status(201).json({ data: role });
};

/** PUT /api/roles/:id — body: any of { roleName, roleCode, isValid } */
const update = async (req, res) => {
  const role = await roleModel.update(req.params.id, req.body ?? {});

  res.status(200).json({ data: role });
};

module.exports = { list, create, update };
