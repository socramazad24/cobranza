// src/routes/dashboardRoutes.js
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/authMiddleware');
const { getDashboardAdmin, getDashboardCobrador } = require('../controllers/dashboardController');

// ADMIN: dashboard global
router.get('/admin', verifyToken, getDashboardAdmin);

// COBRADOR: dashboard personal
router.get('/cobrador', verifyToken, getDashboardCobrador);

module.exports = router;
