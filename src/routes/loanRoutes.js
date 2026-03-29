const express = require('express');
const router = express.Router();
const { createLoan, getClavos } = require('../controllers/loanController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.post('/', verifyToken, createLoan);
router.get('/clavos', verifyToken, getClavos);

module.exports = router;