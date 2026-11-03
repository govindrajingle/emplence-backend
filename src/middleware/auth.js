'use strict';

const jwt = require('jsonwebtoken');

const { assertAdminKey } = require('./adminKey');
const { createAppError } = require('../utils/errors');

/**
 * Authentication and tenant scoping.
 *
 * Two kinds of callers are accepted on `/api/*`:
 * 1. `x-admin-key: $ADMIN_API_KEY` — bootstrap/deployment key, treated as a
 *    global administrator (companyId = null, hierarchy 0).
 * 2. `Authorization: Bearer <jwt>` — a logged-in user (`POST /api/auth/login`).
 *    The token carries the user's role code, company scope and hierarchy level.
 *
 * Company users (sub-admins) can only touch records of their own company.
 */

const ADMIN_ROLE_CODE = 'ADMIN';
const DEFAULT_TOKEN_TTL_SECONDS = 8 * 60 * 60; // 8 hours

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw createAppError(
      503,
      'Authentication is not configured. Set JWT_SECRET in the environment to enable login.',
    );
  }

  return secret;
};

const getTokenTtlSeconds = () => {
  const ttl = Number(process.env.AUTH_TOKEN_TTL_SECONDS);

  return Number.isSafeInteger(ttl) && ttl > 0 ? ttl : DEFAULT_TOKEN_TTL_SECONDS;
};

/** Signs a session token for a logged-in user. */
const signToken = (user) =>
  jwt.sign(
    {
      roleCode: user.role_code,
      companyId: user.company_id,
      hierarchyLevel: user.hierarchy_level,
    },
    getJwtSecret(),
    { subject: String(user.id), expiresIn: getTokenTtlSeconds() },
  );

/** Maps jsonwebtoken errors onto API errors. */
const mapTokenError = (error) => {
  if (error.name === 'TokenExpiredError') {
    return createAppError(401, 'Session token has expired. Log in again.');
  }
  if (error.name === 'JsonWebTokenError' || error.name === 'NotBeforeError') {
    return createAppError(401, 'Invalid session token.');
  }

  return error;
};

/**
 * Resolves the caller into `req.actor`:
 * { type, userId, roleCode, companyId, hierarchyLevel }
 * `companyId: null` means the actor is not limited to one company.
 */
const requireActor = (req, res, next) => {
  try {
    if (req.get('x-admin-key')) {
      assertAdminKey(req);
      req.actor = {
        type: 'bootstrap',
        userId: null,
        roleCode: ADMIN_ROLE_CODE,
        companyId: null,
        hierarchyLevel: 0,
      };

      return next();
    }

    const [scheme, token] = (req.get('authorization') ?? '').split(' ');

    if (!token || scheme.toLowerCase() !== 'bearer') {
      throw createAppError(
        401,
        'Authentication required: send `Authorization: Bearer <token>` from POST /api/auth/login.',
      );
    }

    const payload = jwt.verify(token, getJwtSecret());

    req.actor = {
      type: 'user',
      userId: Number(payload.sub),
      roleCode: payload.roleCode,
      companyId: payload.companyId ?? null,
      hierarchyLevel: Number(payload.hierarchyLevel) || 0,
    };

    next();
  } catch (error) {
    next(mapTokenError(error));
  }
};

const isGlobalActor = (actor) => actor.companyId === null;

/** Only administrators (global admin or a company sub-admin) manage users/roles. */
const assertAdminActor = (actor) => {
  if (actor.roleCode !== ADMIN_ROLE_CODE) {
    throw createAppError(403, 'This operation requires the ADMIN role.');
  }
};

const assertGlobalActor = (actor) => {
  if (!isGlobalActor(actor)) {
    throw createAppError(403, 'This operation is limited to the platform administrator.');
  }
};

/** The company a write must target, given the caller's scope. */
const resolveCompanyScope = (actor, requestedCompanyId) => {
  if (isGlobalActor(actor)) {
    return requestedCompanyId;
  }

  if (
    requestedCompanyId !== undefined &&
    requestedCompanyId !== null &&
    requestedCompanyId !== '' &&
    Number(requestedCompanyId) !== actor.companyId
  ) {
    throw createAppError(403, 'You can only manage records of your own company.');
  }

  return actor.companyId;
};

/** Read guard: a company user may only read its own company's records. */
const assertCompanyRead = (actor, companyId) => {
  if (!isGlobalActor(actor) && Number(companyId) !== actor.companyId) {
    throw createAppError(403, 'You can only access records of your own company.');
  }
};

/**
 * Company sub-admins may only grant roles that belong to their company (or a
 * global role) and whose hierarchy level is strictly below their own authority.
 */
const assertRoleAssignable = (actor, role) => {
  if (isGlobalActor(actor)) {
    return;
  }

  if (role.company_id !== null && role.company_id !== actor.companyId) {
    throw createAppError(403, 'That role belongs to another company.');
  }

  if (role.hierarchy_level <= actor.hierarchyLevel) {
    throw createAppError(
      403,
      'You can only assign roles with a lower authority than your own (higher hierarchyLevel).',
    );
  }
};

module.exports = {
  ADMIN_ROLE_CODE,
  DEFAULT_TOKEN_TTL_SECONDS,
  getTokenTtlSeconds,
  signToken,
  requireActor,
  isGlobalActor,
  assertAdminActor,
  assertGlobalActor,
  resolveCompanyScope,
  assertCompanyRead,
  assertRoleAssignable,
};
