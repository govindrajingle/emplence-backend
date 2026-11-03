'use strict';

const roleModel = require('../models/roleModel');
const userModel = require('../models/userModel');
const {
  assertAdminActor,
  assertRoleAssignable,
  isGlobalActor,
  resolveCompanyScope,
} = require('../middleware/auth');
const { createAppError } = require('../utils/errors');
const { hasOwn, parseOptionalBoolean, parseRequiredText } = require('../utils/validation');

/**
 * HTTP layer for `/api/users`.
 *
 * - Company sub-admins only see and modify users of their own company, and can
 *   only grant roles below their own authority.
 * - Global actors (`x-admin-key` or a company-less admin) manage every company.
 */

/** Resolves a role code for the target company and checks the caller may grant it. */
const resolveAssignableRole = async (actor, roleCode, companyId) => {
  const code = parseRequiredText(roleCode, 'roleCode', 50).toUpperCase();
  const role = await roleModel.findByCode(code, { companyId });

  if (!role) {
    throw createAppError(400, `Role "${code}" does not exist for this company scope.`);
  }

  assertRoleAssignable(actor, role);

  return role;
};

/** GET /api/users?companyId=&locationId=&includeInvalid= */
const list = async (req, res) => {
  const includeInvalid = parseOptionalBoolean(req.query.includeInvalid, 'includeInvalid');
  let companyId = req.query.companyId;

  if (!isGlobalActor(req.actor)) {
    if (companyId !== undefined && companyId !== '' && Number(companyId) !== req.actor.companyId) {
      throw createAppError(403, 'You can only access users of your own company.');
    }
    companyId = req.actor.companyId;
  }

  const users = await userModel.findAll({
    companyId,
    locationId: req.query.locationId,
    includeInvalid,
  });

  res.status(200).json({ count: users.length, data: users });
};

/** POST /api/users — company is forced for sub-admins; role must be subordinate. */
const create = async (req, res) => {
  assertAdminActor(req.actor);

  const body = req.body ?? {};
  const companyId = resolveCompanyScope(req.actor, body.companyId);
  const role = await resolveAssignableRole(
    req.actor,
    hasOwn(body, 'roleCode') ? body.roleCode : userModel.PUBLIC_REGISTRATION_ROLE_CODE,
    companyId ?? null,
  );

  const user = await userModel.create({
    username: body.username,
    password: body.password,
    roleId: role.id,
    companyId,
    locationId: body.locationId,
  });

  res.status(201).json({ data: user });
};

/** PUT /api/users/:id — partial update inside the caller's company scope. */
const update = async (req, res) => {
  assertAdminActor(req.actor);

  const existing = await userModel.findById(req.params.id);

  if (!existing) {
    throw createAppError(404, `User ${req.params.id} was not found.`);
  }

  const body = req.body ?? {};

  if (!isGlobalActor(req.actor)) {
    if (existing.company_id !== req.actor.companyId) {
      throw createAppError(403, 'You can only manage users of your own company.');
    }
    if (hasOwn(body, 'companyId')) {
      throw createAppError(403, 'You cannot move users between companies.');
    }
    if (existing.hierarchy_level <= req.actor.hierarchyLevel) {
      throw createAppError(
        403,
        'You cannot modify a user with the same or higher authority than your own.',
      );
    }
  }

  const changes = {};

  if (hasOwn(body, 'username')) changes.username = body.username;
  if (hasOwn(body, 'password')) changes.password = body.password;
  if (hasOwn(body, 'isValid')) changes.isValid = body.isValid;
  if (hasOwn(body, 'companyId')) changes.companyId = body.companyId;
  if (hasOwn(body, 'locationId')) changes.locationId = body.locationId;

  if (hasOwn(body, 'roleCode')) {
    const targetCompany = hasOwn(body, 'companyId') ? body.companyId : existing.company_id;
    const role = await resolveAssignableRole(req.actor, body.roleCode, targetCompany ?? null);
    changes.roleId = role.id;
  }

  const user = await userModel.update(existing.id, changes);

  res.status(200).json({ data: user });
};

module.exports = { list, create, update };
