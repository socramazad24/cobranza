const express = require('express');
const router = express.Router();

const {
  createLoan,
  updateLoan,
  getClavos,
} = require('../controllers/loanController');

const { verifyToken } = require('../middlewares/authMiddleware');

router.post('/', verifyToken, createLoan);
router.put('/:id', verifyToken, updateLoan);
router.get('/clavos', verifyToken, getClavos);

module.exports = router;