'use strict';

const roleModel = require('../models/roleModel');
const userModel = require('../models/userModel');
const {
  PERMISSIONS,
  assertCanCreateUser,
  assertPermission,
  assertRoleAssignable,
  canManageUser,
  isGlobalActor,
  resolveTargetCompany,
  validateCompanyAccess,
} = require('../services/authorizationService');
const { createAppError } = require('../utils/errors');
const { hasOwn, parseOptionalBoolean, parseRequiredText } = require('../utils/validation');

/**
 * HTTP layer for `/api/users`.
 *
 * No authorization rules live here: every check is delegated to
 * `src/services/authorizationService.js` (permission + company + hierarchy).
 * Company ids, role ids and hierarchy levels from the request are validated
 * against the authenticated actor, never trusted.
 */

/** Resolves a role code inside the target company scope. */
const resolveRole = async (roleCode, companyId) => {
  const code = parseRequiredText(roleCode, 'roleCode', 50).toUpperCase();
  const role = await roleModel.findByCode(code, { companyId: companyId ?? null });

  if (!role) {
    throw createAppError(400, `Role "${code}" does not exist for this company scope.`);
  }

  return role;
};

/** GET /api/users?companyId=&locationId=&includeInvalid= */
const list = async (req, res) => {
  assertPermission(req.actor, PERMISSIONS.USER_VIEW);

  const includeInvalid = parseOptionalBoolean(req.query.includeInvalid, 'includeInvalid');
  let companyId = req.query.companyId;
  let hierarchyGreaterThan;

  if (!isGlobalActor(req.actor)) {
    if (companyId !== undefined && companyId !== '' && Number(companyId) !== Number(req.actor.companyId)) {
      throw createAppError(403, 'You can only access users of your own company.');
    }

    companyId = req.actor.companyId;
    // Company users only ever see their subordinates (Owner -> Managers/Employees).
    hierarchyGreaterThan = req.actor.hierarchyLevel;
  }

  const users = await userModel.findAll({
    companyId,
    locationId: req.query.locationId,
    includeInvalid,
    hierarchyGreaterThan,
  });

  res.status(200).json({ count: users.length, data: users });
};

/** POST /api/users — creates Owners/Managers/Employees depending on the actor. */
const create = async (req, res) => {
  const body = req.body ?? {};
  const companyId = resolveTargetCompany(req.actor, body.companyId);
  const role = await resolveRole(body.roleCode ?? userModel.PUBLIC_REGISTRATION_ROLE_CODE, companyId);

  assertCanCreateUser(req.actor, { role, companyId });

  const user = await userModel.create({
    username: body.username,
    password: body.password,
    roleId: role.id,
    companyId,
    locationId: body.locationId,
    createdByUserId: req.actor.userId,
  });

  res.status(201).json({ data: user });
};

/** PUT /api/users/:id — permission + hierarchy validated against the target user. */
const update = async (req, res) => {
  const existing = await userModel.findById(req.params.id);

  if (!existing) {
    throw createAppError(404, `User ${req.params.id} was not found.`);
  }

  canManageUser(req.actor, existing, PERMISSIONS.USER_UPDATE);

  const body = req.body ?? {};
  const changes = {};

  if (hasOwn(body, 'username')) changes.username = body.username;
  if (hasOwn(body, 'password')) changes.password = body.password;
  if (hasOwn(body, 'isValid')) changes.isValid = body.isValid;
  if (hasOwn(body, 'locationId')) changes.locationId = body.locationId;

  if (hasOwn(body, 'companyId')) {
    const companyId = resolveTargetCompany(req.actor, body.companyId);
    validateCompanyAccess(req.actor, companyId);
    changes.companyId = companyId;
  }

  if (hasOwn(body, 'roleCode')) {
    const targetCompany = changes.companyId !== undefined ? changes.companyId : existing.company_id;
    const role = await resolveRole(body.roleCode, targetCompany);

    assertRoleAssignable(req.actor, role);
    changes.roleId = role.id;
  }

  const user = await userModel.update(existing.id, changes);

  res.status(200).json({ data: user });
};

module.exports = { list, create, update };
