// src/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const { registerPayment, getPaymentHistory, getActiveLoans, renewLoan } = require('../controllers/paymentController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.get('/active', verifyToken, getActiveLoans);
router.post('/pay', verifyToken, registerPayment);
router.get('/history/:prestamo_id', verifyToken, getPaymentHistory);
router.post('/renew', verifyToken, renewLoan);

module.exports = router;