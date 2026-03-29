const express = require('express');
const router = express.Router();
const { getResumen, getResumenCobrador, getResumenGastos } = require('../controllers/reportController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.get('/resumen',           verifyToken, getResumen);
router.get('/resumen-cobrador',  verifyToken, getResumenCobrador);
router.get('/gastos-resumen',    verifyToken, getResumenGastos);

module.exports = router;