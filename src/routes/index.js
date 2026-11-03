'use strict';

const express = require('express');

const helloRoutes = require('./helloRoutes');

const router = express.Router();

// Application route table. New resources are mounted here as the API grows.
router.use('/hello', helloRoutes);

module.exports = router;
