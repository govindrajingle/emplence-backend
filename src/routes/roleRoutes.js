'use strict';

const express = require('express');

const roleController = require('../controllers/roleController');
const { requireAdminKey } = require('../middleware/adminKey');

const router = express.Router();

// Reads are public; role creation/update is backend-controlled (admin key required).
router.get('/', roleController.list);
router.post('/', requireAdminKey, roleController.create);
router.put('/:id', requireAdminKey, roleController.update);

module.exports = router;
