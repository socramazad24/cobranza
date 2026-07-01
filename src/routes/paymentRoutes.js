// src/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();

const {
  registerPayment,
  getPaymentHistory,
  getActiveLoans,
  renewLoan,
  getPagosDelDia,  // 🆕
} = require('../controllers/paymentController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.get('/active', verifyToken, getActiveLoans);
router.post('/pay', verifyToken, registerPayment);
router.get('/history/:prestamo_id', verifyToken, getPaymentHistory);
router.get('/history-legacy/:prestamoid', verifyToken, getPaymentHistory);

// 🆕 Obtener pagos del día de un préstamo
router.get('/today/:prestamoid', verifyToken, getPagosDelDia);

router.post('/renew', verifyToken, renewLoan);

module.exports = router;
