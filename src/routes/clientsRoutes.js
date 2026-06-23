const express = require('express');
const router = express.Router();

const {
  getClientes,
  getCobradores,
  deleteClientes,
} = require('../controllers/clientController');

const { verifyToken } = require('../middlewares/authMiddleware');

router.get('/', verifyToken, getClientes);
router.get('/cobradores', verifyToken, getCobradores);
router.delete('/', verifyToken, deleteClientes);

module.exports = router;