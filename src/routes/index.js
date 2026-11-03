'use strict';

const express = require('express');

const companyRoutes = require('./companyRoutes');
const helloRoutes = require('./helloRoutes');
const locationRoutes = require('./locationRoutes');
const roleRoutes = require('./roleRoutes');
const userRoutes = require('./userRoutes');

const router = express.Router();

// Liveness endpoint kept from the first iteration.
router.use('/hello', helloRoutes);

// REST resources (see RESTEndpoints.md).
router.use('/api/companies', companyRoutes);
router.use('/api/companies-locations', locationRoutes);
router.use('/api/roles', roleRoutes);
router.use('/api/users', userRoutes);

module.exports = router;
