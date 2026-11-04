'use strict';

const { createAppError } = require('../utils/errors');

/**
 * Reusable authorization logic — the single source of truth used by controllers,
 * so no endpoint re-implements hierarchy or company rules.
 *
 * Authority model:
 *   - `hierarchy_level` (master_roles): lower number = more authority.
 *     ADMIN 100 < OWNER 200 < MANAGER 250 < EMPLOYEE 300.
 *   - An actor may act on a target only when
 *       actor.hierarchyLevel < targetRole.hierarchyLevel
 *   - Permissions (role_permissions) are checked separately from hierarchy.
 *   - Company scope: non-global actors only touch their own company.
 *
 * The actor object always comes from the server (JWT + database lookup), never
 * from request bodies.
 */

const PERMISSIONS = Object.freeze({
  USER_CREATE: 'USER_CREATE',
  USER_VIEW: 'USER_VIEW',
  USER_UPDATE: 'USER_UPDATE',
  USER_DELETE: 'USER_DELETE',
});

/** Global actors at or above this authority (ADMIN = 100) are platform admins. */
const PLATFORM_ADMIN_MAX_LEVEL = 100;

const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

const normalizeCode = (value) => String(value ?? '').trim().toUpperCase();

/** Global actor = not pinned to one company (bootstrap key or company-less admin). */
const isGlobalActor = (actor) => actor?.companyId === null || actor?.companyId === undefined;

/** Role rows may come from `master_roles` (is_valid) or a user join (role_is_valid). */
const roleIsActive = (role) => Boolean(role?.role_is_valid ?? role?.is_valid);

const roleCompanyId = (role) => role?.role_company_id ?? role?.company_id ?? null;

const hasPermission = (actor, permissionCode) => {
  const code = normalizeCode(permissionCode);

  return Array.isArray(actor?.permissions) && actor.permissions.includes(code);
};

const assertPermission = (actor, permissionCode) => {
  if (!hasPermission(actor, permissionCode)) {
    throw createAppError(403, `Missing required permission: ${normalizeCode(permissionCode)}.`);
  }
};

/** Platform administrator = global actor at the top of the hierarchy (ADMIN / bootstrap). */
const isPlatformAdministrator = (actor) =>
  isGlobalActor(actor) && Number(actor.hierarchyLevel) <= PLATFORM_ADMIN_MAX_LEVEL;

const assertPlatformAdministrator = (actor) => {
  if (!isPlatformAdministrator(actor)) {
    throw createAppError(403, 'This operation is limited to the platform administrator.');
  }
};

/** Company rule: globals may target anyone; company users only their own company. */
const validateCompanyAccess = (actor, companyId) => {
  if (isGlobalActor(actor)) {
    return;
  }

  if (companyId === null || companyId === undefined || Number(companyId) !== Number(actor.companyId)) {
    throw createAppError(403, 'You can only manage records of your own company.');
  }
};

/** Company a write must target: globals keep the requested value, others are pinned. */
const resolveTargetCompany = (actor, requestedCompanyId) => {
  if (isGlobalActor(actor)) {
    return requestedCompanyId ?? null;
  }

  if (
    requestedCompanyId !== undefined &&
    requestedCompanyId !== null &&
    requestedCompanyId !== '' &&
    Number(requestedCompanyId) !== Number(actor.companyId)
  ) {
    throw createAppError(403, 'You can only manage records of your own company.');
  }

  return actor.companyId;
};

/**
 * A role is assignable when it is active, inside the actor's company scope and
 * strictly below the actor's authority.
 */
const assertRoleAssignable = (actor, role) => {
  if (!role) {
    throw createAppError(400, 'A target role is required.');
  }

  if (!roleIsActive(role)) {
    throw createAppError(403, 'The target role is not active.');
  }

  const roleCompany = roleCompanyId(role);

  if (!isGlobalActor(actor) && roleCompany !== null && Number(roleCompany) !== Number(actor.companyId)) {
    throw createAppError(403, 'That role belongs to another company.');
  }

  if (!(Number(actor.hierarchyLevel) < Number(role.hierarchy_level))) {
    throw createAppError(
      403,
      'You can only assign roles with a lower authority than your own (higher hierarchy level).',
    );
  }
};

/**
 * Core rule used by every user-management endpoint:
 *   1. permission, 2. same company, 3. lower authority, 4. active target role,
 *   5. no self-management through the user API.
 */
const canManageUser = (actor, targetUser, permissionCode) => {
  assertPermission(actor, permissionCode);

  if (!targetUser) {
    throw createAppError(404, 'Target user was not found.');
  }

  if (actor.userId !== null && actor.userId !== undefined && Number(targetUser.id) === Number(actor.userId)) {
    throw createAppError(403, 'You cannot manage your own account through the user API.');
  }

  validateCompanyAccess(actor, targetUser.company_id);

  assertRoleAssignable(actor, {
    role_is_valid: targetUser.role_is_valid,
    role_company_id: targetUser.role_company_id,
    hierarchy_level: targetUser.hierarchy_level,
  });

  return true;
};

/** Rules for creating a user with a given role in a given company. */
const assertCanCreateUser = (actor, { role, companyId }) => {
  assertPermission(actor, PERMISSIONS.USER_CREATE);
  validateCompanyAccess(actor, companyId);
  assertRoleAssignable(actor, role);
};

module.exports = {
  PERMISSIONS,
  ALL_PERMISSIONS,
  PLATFORM_ADMIN_MAX_LEVEL,
  isGlobalActor,
  hasPermission,
  assertPermission,
  isPlatformAdministrator,
  assertPlatformAdministrator,
  validateCompanyAccess,
  resolveTargetCompany,
  assertRoleAssignable,
  canManageUser,
  assertCanCreateUser,
};
