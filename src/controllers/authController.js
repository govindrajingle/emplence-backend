'use strict';

const bcrypt = require('bcryptjs');

const companyModel = require('../models/companyModel');
const userModel = require('../models/userModel');
const { getTokenTtlSeconds, signToken } = require('../middleware/auth');
const { createAppError } = require('../utils/errors');
const { parseRequiredText } = require('../utils/validation');

/**
 * POST /api/auth/login
 *
 * Verifies the password hash and issues a JWT scoped to the user's company, so a
 * company sub-admin can only operate on that company's data afterwards.
 */
const login = async (req, res) => {
  const body = req.body ?? {};
  const username = parseRequiredText(body.username, 'username', 100);

  if (typeof body.password !== 'string' || body.password.length === 0) {
    throw createAppError(400, 'password is required.');
  }

  const user = await userModel.findCredentialsByUsername(username);
  const passwordMatches = user ? await bcrypt.compare(body.password, user.password) : false;

  if (!user || !passwordMatches || !user.is_valid) {
    // Same message for unknown user and wrong password.
    throw createAppError(401, 'Invalid username or password.');
  }

  // A company user is bound to one company; global admins have company_id = null.
  const company = user.company_id === null ? null : await companyModel.findById(user.company_id);

  if (user.company_id !== null && (!company || !company.is_valid)) {
    throw createAppError(403, 'The company linked to this account is not active.');
  }

  const token = signToken(user);

  res.status(200).json({
    data: {
      token,
      tokenType: 'Bearer',
      expiresInSeconds: getTokenTtlSeconds(),
      user: {
        id: user.id,
        username: user.username,
        roleCode: user.role_code,
        roleScope: company ? 'company' : 'global',
        hierarchyLevel: user.hierarchy_level,
        companyId: user.company_id,
        companyName: company?.company_name ?? null,
      },
    },
  });
};

module.exports = { login };
