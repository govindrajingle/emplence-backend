'use strict';

const express = require('express');

const roleController = require('../controllers/roleController');

const router = express.Router();

// Authentication/authorisation is applied when the router is mounted (see routes/index.js).
router.get('/', roleController.list);
router.post('/', roleController.create);
router.put('/:id', roleController.update);

module.exports = router;
