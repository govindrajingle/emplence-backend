'use strict';

const express = require('express');

const authRoutes = require('./authRoutes');
const companyRoutes = require('./companyRoutes');
const helloRoutes = require('./helloRoutes');
const locationRoutes = require('./locationRoutes');
const roleRoutes = require('./roleRoutes');
const userRoutes = require('./userRoutes');
const { requireActor } = require('../middleware/auth');

const router = express.Router();

// Liveness endpoint kept from the first iteration (public).
router.use('/hello', helloRoutes);

// Public authentication endpoint.
router.use('/api/auth', authRoutes);

// REST resources: every request must resolve to an actor (Bearer token or
// bootstrap x-admin-key), and company users are scoped to their own company.
router.use('/api/companies', requireActor, companyRoutes);
router.use('/api/companies-locations', requireActor, locationRoutes);
router.use('/api/roles', requireActor, roleRoutes);
router.use('/api/users', requireActor, userRoutes);

module.exports = router;
