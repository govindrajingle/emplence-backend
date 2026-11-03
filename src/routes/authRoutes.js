'use strict';

const express = require('express');

const authController = require('../controllers/authController');

const router = express.Router();

// Public: obtain a Bearer token scoped to the user's company.
router.post('/login', authController.login);

module.exports = router;
