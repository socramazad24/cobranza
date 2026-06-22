const express = require('express');
const router = express.Router();

const {
  getRutas,
  createRuta,
  updateRuta,
  deleteRuta,
  asignarRutas,
  getRutasCobrador,
  getResumenRuta,
} = require('../controllers/rutaController');

const { verifyToken } = require('../middlewares/authMiddleware');

router.get('/', verifyToken, getRutas);
router.get('/cobrador/:cobrador_id', verifyToken, getRutasCobrador);
router.get('/:id/resumen', verifyToken, getResumenRuta);

router.post('/', verifyToken, createRuta);
router.put('/:id', verifyToken, updateRuta);
router.put('/cobrador/:id', verifyToken, asignarRutas);
router.delete('/:id', verifyToken, deleteRuta);

module.exports = router;