'use strict';

const userModel = require('../models/userModel');
const { assertAdminKey } = require('../middleware/adminKey');
const { hasOwn, parseOptionalBoolean, parseRequiredText } = require('../utils/validation');

/**
 * HTTP layer for `/api/users`.
 *
 * Role rules: the default EMPLOYEE role is assigned by backend logic; any other
 * role (in particular ADMIN) requires the ADMIN_API_KEY header.
 */

/** Normalises an optional roleCode from the body. */
const readRoleCode = (body) =>
  hasOwn(body, 'roleCode') ? parseRequiredText(body.roleCode, 'roleCode', 50).toUpperCase() : undefined;

/** Blocks privileged role assignment unless the admin key is valid. */
const guardPrivilegedRole = (req, roleCode) => {
  if (roleCode && roleCode !== userModel.PUBLIC_REGISTRATION_ROLE_CODE) {
    assertAdminKey(req);
  }
};

/** GET /api/users?companyId=&locationId=&includeInvalid= */
const list = async (req, res) => {
  const users = await userModel.findAll({
    companyId: req.query.companyId,
    locationId: req.query.locationId,
    includeInvalid: parseOptionalBoolean(req.query.includeInvalid, 'includeInvalid'),
  });

  res.status(200).json({ count: users.length, data: users });
};

/** POST /api/users — body: { username, password, roleCode?, companyId?, locationId? } */
const create = async (req, res) => {
  const body = req.body ?? {};
  const roleCode = readRoleCode(body);

  guardPrivilegedRole(req, roleCode);

  const user = await userModel.create({
    username: body.username,
    password: body.password,
    roleCode,
    companyId: body.companyId,
    locationId: body.locationId,
  });

  res.status(201).json({ data: user });
};

/** PUT /api/users/:id — partial update of username/password/roleCode/companyId/locationId/isValid */
const update = async (req, res) => {
  const body = req.body ?? {};
  const roleCode = readRoleCode(body);

  guardPrivilegedRole(req, roleCode);

  const user = await userModel.update(req.params.id, body);

  res.status(200).json({ data: user });
};

module.exports = { list, create, update };
