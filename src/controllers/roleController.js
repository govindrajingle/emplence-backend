'use strict';

const roleModel = require('../models/roleModel');
const { assertAdminActor, isGlobalActor, resolveCompanyScope } = require('../middleware/auth');
const { createAppError } = require('../utils/errors');
const { hasOwn, parseOptionalBoolean } = require('../utils/validation');

/**
 * HTTP layer for `/api/roles`.
 *
 * - Global actor (`x-admin-key` or a user without a company): can create global
 *   roles or roles for any company.
 * - Company sub-admin: always creates roles inside its own company and only with
 *   a `hierarchyLevel` greater (lower authority) than its own.
 */

/** GET /api/roles?includeInvalid=true */
const list = async (req, res) => {
  const includeInvalid = parseOptionalBoolean(req.query.includeInvalid, 'includeInvalid');

  const roles = await roleModel.findAll({
    companyId: isGlobalActor(req.actor) ? undefined : req.actor.companyId,
    includeInvalid,
  });

  res.status(200).json({ count: roles.length, data: roles });
};

/** POST /api/roles — body: { roleName, roleCode, hierarchyLevel?, companyId? } */
const create = async (req, res) => {
  assertAdminActor(req.actor);

  const body = req.body ?? {};

  if (!isGlobalActor(req.actor)) {
    const requestedLevel = body.hierarchyLevel === undefined ? 100 : Number(body.hierarchyLevel);

    if (!Number.isSafeInteger(requestedLevel) || requestedLevel <= req.actor.hierarchyLevel) {
      throw createAppError(
        403,
        `hierarchyLevel must be greater than your own level (${req.actor.hierarchyLevel}).`,
      );
    }
  }

  const companyId = isGlobalActor(req.actor)
    ? (body.companyId ?? null)
    : resolveCompanyScope(req.actor, body.companyId);

  const role = await roleModel.create({
    roleName: body.roleName,
    roleCode: body.roleCode,
    companyId,
    hierarchyLevel: body.hierarchyLevel,
  });

  res.status(201).json({ data: role });
};

/** PUT /api/roles/:id — company roles only for sub-admins. */
const update = async (req, res) => {
  assertAdminActor(req.actor);

  const existing = await roleModel.findById(req.params.id);

  if (!existing) {
    throw createAppError(404, `Role ${req.params.id} was not found.`);
  }

  const body = req.body ?? {};

  if (!isGlobalActor(req.actor)) {
    if (existing.company_id !== req.actor.companyId) {
      throw createAppError(403, 'You can only manage roles of your own company.');
    }

    if (hasOwn(body, 'hierarchyLevel')) {
      const requestedLevel = Number(body.hierarchyLevel);

      if (!Number.isSafeInteger(requestedLevel) || requestedLevel <= req.actor.hierarchyLevel) {
        throw createAppError(
          403,
          `hierarchyLevel must be greater than your own level (${req.actor.hierarchyLevel}).`,
        );
      }
    }
  }

  const role = await roleModel.update(existing.id, body);

  res.status(200).json({ data: role });
};

module.exports = { list, create, update };
