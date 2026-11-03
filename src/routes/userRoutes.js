'use strict';

const express = require('express');

const userController = require('../controllers/userController');

const router = express.Router();

router.get('/', userController.list);
router.post('/', userController.create);
router.put('/:id', userController.update);

module.exports = router;
