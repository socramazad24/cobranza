const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/authMiddleware');
const {
  abrirCaja,
  cerrarCaja,
  reabrirCaja,
  editarMontoRecibido,
  getResumenCajaAdmin,
  getHistorialCobrador,
  getMiCajaHoy,
} = require('../controllers/cajaController');

// Cobrador: ver su propia caja del día
router.get('/hoy', verifyToken, getMiCajaHoy);

// Admin: ver resumen de todas las cajas (?fecha=YYYY-MM-DD)
router.get('/resumen', verifyToken, getResumenCajaAdmin);

// Admin: historial de un cobrador
router.get('/historial/:cobradorid', verifyToken, getHistorialCobrador);

// Abrir / crear caja o editar base
router.post('/', verifyToken, abrirCaja);

// Cerrar caja
router.put('/:id/cerrar', verifyToken, cerrarCaja);

// Reabrir caja (solo admin)
router.put('/:id/reabrir', verifyToken, reabrirCaja);

// Editar monto recibido sin historial (admin o cajero)
router.put('/:id/monto-recibido', verifyToken, editarMontoRecibido);

module.exports = router;