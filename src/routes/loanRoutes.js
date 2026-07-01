// src/routes/loanRoutes.js
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/authMiddleware');
const {
  createLoan,
  updateLoan,
  getClavos,
  importarPrestamos,
  getLoansByCobrador,
  getCalendarioPagos,
} = require('../controllers/loanController');

router.post('/', verifyToken, createLoan);
router.put('/:id', verifyToken, updateLoan);
router.get('/clavos', verifyToken, getClavos);
router.post('/importar', verifyToken, importarPrestamos);
router.get('/cobrador/:cobradorId', verifyToken, getLoansByCobrador);
router.get('/:id/calendario', verifyToken, getCalendarioPagos);

module.exports = router;
