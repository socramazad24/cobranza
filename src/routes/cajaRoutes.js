const express = require('express');
const router = express.Router();

const {
  abrirCaja,
  cerrarCaja,
  getResumenCajaAdmin,
  getHistorialCobrador,
  getMiCajaHoy,
} = require('../controllers/cajaController');

const { verifyToken } = require('../middlewares/authMiddleware');

router.post('/', verifyToken, abrirCaja);
router.put('/:id/cerrar', verifyToken, cerrarCaja);
router.get('/resumen', verifyToken, getResumenCajaAdmin);
router.get('/historial/:cobrador_id', verifyToken, getHistorialCobrador);
router.get('/hoy', verifyToken, getMiCajaHoy);

module.exports = router;