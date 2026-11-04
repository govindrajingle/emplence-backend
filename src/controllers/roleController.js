'use strict';

const roleModel = require('../models/roleModel');
const rolePermissionModel = require('../models/rolePermissionModel');
const {
  assertPlatformAdministrator,
  isGlobalActor,
} = require('../services/authorizationService');
const { createAppError } = require('../utils/errors');
const { parseOptionalBoolean } = require('../utils/validation');

/**
 * HTTP layer for `/api/roles`.
 *
 * Reads are available to any authenticated actor (company users see global roles
 * plus their own company's roles, each with its permission codes).
 * Role/permission writes are platform-administrator only: roles are catalogued
 * centrally so company users cannot grant themselves authority.
 */

/** Attaches the active permission codes to each role row. */
const withPermissions = async (roles) => {
  const permissionsByRole = await rolePermissionModel.listCodesByRoleIds(roles.map((role) => role.id));

  return roles.map((role) => ({
    ...role,
    permissions: permissionsByRole.get(role.id) ?? [],
  }));
};

/** GET /api/roles?includeInvalid=true */
const list = async (req, res) => {
  const includeInvalid = parseOptionalBoolean(req.query.includeInvalid, 'includeInvalid');

  const roles = await roleModel.findAll({
    companyId: isGlobalActor(req.actor) ? undefined : req.actor.companyId,
    includeInvalid,
  });

  res.status(200).json({ count: roles.length, data: await withPermissions(roles) });
};

/** POST /api/roles — body: { roleName, roleCode, companyId?, hierarchyLevel? } */
const create = async (req, res) => {
  assertPlatformAdministrator(req.actor);

  const body = req.body ?? {};

  const role = await roleModel.create({
    roleName: body.roleName,
    roleCode: body.roleCode,
    companyId: body.companyId ?? null,
    hierarchyLevel: body.hierarchyLevel,
  });

  res.status(201).json({ data: { ...role, permissions: [] } });
};

/** PUT /api/roles/:id — body: any of { roleName, roleCode, hierarchyLevel, isValid } */
const update = async (req, res) => {
  assertPlatformAdministrator(req.actor);

  const role = await roleModel.update(req.params.id, req.body ?? {});

  res.status(200).json({ data: role });
};

/** PUT /api/roles/:id/permissions — body: { permissions: ["USER_VIEW", ...] } */
const updatePermissions = async (req, res) => {
  assertPlatformAdministrator(req.actor);

  const role = await roleModel.findById(req.params.id);

  if (!role) {
    throw createAppError(404, `Role ${req.params.id} was not found.`);
  }

  const permissions = await rolePermissionModel.setForRole(role.id, req.body?.permissions ?? []);

  res.status(200).json({ data: { roleId: role.id, roleCode: role.role_code, permissions } });
};

module.exports = { list, create, update, updatePermissions };
