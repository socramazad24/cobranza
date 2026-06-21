// routes/clientsRoutes.js
const express = require('express');
const router  = express.Router();
const { verifyToken } = require('../middlewares/authMiddleware');
const { getClientes, getCobradores, deleteClientes } = require('../controllers/clientController');

router.get('/',           verifyToken, getClientes);
router.get('/cobradores', verifyToken, getCobradores);
// Agregar esta línea
router.delete('/', verifyToken, deleteClientes); // DELETE /api/clients  body: { cliente_ids: [...] }

module.exports = router;