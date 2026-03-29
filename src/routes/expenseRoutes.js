// src/routes/expenseRoutes.js
const express = require('express');
const router = express.Router();
const { registerExpense, getExpenses, uploadComprobante } = require('../controllers/expenseController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.post('/', verifyToken, registerExpense);
router.get('/', verifyToken, getExpenses);
router.post('/upload', verifyToken, uploadComprobante);

module.exports = router;