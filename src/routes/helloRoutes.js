'use strict';

const express = require('express');

const helloController = require('../controllers/helloController');

const router = express.Router();

// GET /hello -> liveness check for the backend.
router.get('/', helloController.getHello);

module.exports = router;
