const express = require('express');
const router = express.Router();
const { login, createCobrador, getCobradores } = require('../controllers/authController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.post('/login', login);
// Aquí podrías agregar un middleware extra "verifyAdmin" antes de createCobrador
router.post('/create-cobrador', verifyToken, createCobrador);
router.get('/cobradores', verifyToken, getCobradores); // <-- NUEVA LÍNEA


module.exports = router;