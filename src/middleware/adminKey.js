'use strict';

const { createAppError } = require('../utils/errors');

/**
 * Minimal guard for backend-controlled operations (role management and
 * privileged role assignment).
 *
 * The project requirement is that roles are never managed through a public API.
 * These endpoints are therefore locked behind a shared admin key supplied by the
 * `ADMIN_API_KEY` environment variable and sent as the `x-admin-key` header.
 * Without the variable the endpoints fail closed with 503.
 *
 * This is a deployment guard, not a replacement for real user authentication.
 */

const ADMIN_KEY_HEADER = 'x-admin-key';

/** Throws when the request does not carry the configured admin key. */
const assertAdminKey = (req) => {
  const configuredKey = process.env.ADMIN_API_KEY;

  if (!configuredKey) {
    throw createAppError(
      503,
      'Role management is disabled. Set ADMIN_API_KEY in the environment to enable it.',
    );
  }

  const providedKey = req.get(ADMIN_KEY_HEADER);

  if (providedKey !== configuredKey) {
    throw createAppError(401, `A valid ${ADMIN_KEY_HEADER} header is required for this operation.`);
  }
};

/** Express middleware variant used by the role routes. */
const requireAdminKey = (req, res, next) => {
  try {
    assertAdminKey(req);
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = { ADMIN_KEY_HEADER, assertAdminKey, requireAdminKey };
