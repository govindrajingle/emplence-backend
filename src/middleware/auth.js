'use strict';

const jwt = require('jsonwebtoken');

const rolePermissionModel = require('../models/rolePermissionModel');
const userModel = require('../models/userModel');
const { ALL_PERMISSIONS, isGlobalActor } = require('../services/authorizationService');
const { assertAdminKey } = require('./adminKey');
const { createAppError } = require('../utils/errors');

/**
 * Authentication (identity) only.
 *
 * `req.actor` is always built from trusted server-side data:
 *   - JWT verified -> user id -> fresh user + role + permissions from PostgreSQL
 *   - or the bootstrap `x-admin-key` (system principal, all permissions)
 *
 * Token claims (roleCode/companyId/hierarchyLevel) are informational for clients;
 * authorization never reads them. All authorization rules live in
 * `src/services/authorizationService.js`.
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

/** Signs a session token for a logged-in user (claims are advisory for clients). */
const signToken = (user) =>
  jwt.sign(
    {
      username: user.username,
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

/** Loads the authenticated user + role + permissions and builds the actor. */
const buildUserActor = async (userId) => {
  const user = await userModel.findById(userId);

  if (!user) {
    throw createAppError(401, 'The account for this token no longer exists.');
  }
  if (!user.is_valid) {
    throw createAppError(403, 'This account is inactive.');
  }
  if (!user.role_is_valid) {
    throw createAppError(403, 'The role assigned to this account is inactive.');
  }

  return {
    type: 'user',
    userId: user.id,
    username: user.username,
    roleId: user.role_id,
    roleCode: user.role_code,
    companyId: user.company_id,
    hierarchyLevel: Number(user.hierarchy_level),
    roleCompanyId: user.role_company_id,
    permissions: await rolePermissionModel.findCodesForRole(user.role_id),
  };
};

/**
 * Resolves the caller into `req.actor`:
 * { type, userId, username, roleId, roleCode, companyId, hierarchyLevel, permissions }
 */
const requireActor = async (req, res, next) => {
  try {
    if (req.get('x-admin-key')) {
      assertAdminKey(req);
      req.actor = {
        type: 'bootstrap',
        userId: null,
        username: 'bootstrap',
        roleId: null,
        roleCode: ADMIN_ROLE_CODE,
        companyId: null,
        hierarchyLevel: 0,
        roleCompanyId: null,
        permissions: [...ALL_PERMISSIONS],
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

    req.actor = await buildUserActor(Number(payload.sub));

    next();
  } catch (error) {
    next(mapTokenError(error));
  }
};

module.exports = {
  ADMIN_ROLE_CODE,
  DEFAULT_TOKEN_TTL_SECONDS,
  getTokenTtlSeconds,
  signToken,
  requireActor,
  isGlobalActor,
};
