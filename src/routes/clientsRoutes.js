// routes/clientsRoutes.js
const express = require('express');
const router  = express.Router();
const { getClientes, getCobradores } = require('../controllers/clientController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.get('/',           verifyToken, getClientes);
router.get('/cobradores', verifyToken, getCobradores);

module.exports = router;