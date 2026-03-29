// src/routes/observacionRoutes.js
const express = require('express');
const router = express.Router();
const {
    createObservacion,
    getObservaciones,
    resolverObservacion
} = require('../controllers/observacionController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.post('/', verifyToken, createObservacion);
router.get('/', verifyToken, getObservaciones);
router.put('/:id/resolver', verifyToken, resolverObservacion);

module.exports = router;