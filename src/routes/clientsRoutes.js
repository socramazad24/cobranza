const express = require('express');
const router = express.Router();

const {
  getClientes,
  getCobradores,
  deleteClientes,
} = require('../controllers/clientController');

const { verifyToken } = require('../middlewares/authMiddleware');

console.log({
  getClientes: typeof getClientes,
  getCobradores: typeof getCobradores,
  deleteClientes: typeof deleteClientes,
  verifyToken: typeof verifyToken,
});

router.get('/', verifyToken, getClientes);
router.get('/cobradores', verifyToken, getCobradores);
router.delete('/', verifyToken, deleteClientes);

module.exports = router;