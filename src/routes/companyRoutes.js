'use strict';

const express = require('express');

const companyController = require('../controllers/companyController');

const router = express.Router();

router.get('/', companyController.list);
router.post('/', companyController.create);
router.put('/:id', companyController.update);

module.exports = router;
