// src/routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const { getAllUsers, updateUser, deleteUser } = require('../controllers/adminController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.get('/users', verifyToken, getAllUsers);
router.put('/users/:id', verifyToken, updateUser);
router.delete('/users/:id', verifyToken, deleteUser);

module.exports = router;