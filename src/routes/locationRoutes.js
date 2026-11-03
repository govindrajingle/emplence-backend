'use strict';

const express = require('express');

const locationController = require('../controllers/locationController');

const router = express.Router();

router.get('/', locationController.list);
router.post('/', locationController.create);
router.put('/:id', locationController.update);

module.exports = router;
