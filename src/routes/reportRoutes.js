const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middlewares/authMiddleware");
const {
  getResumen,
  getResumenCobrador,
  getResumenGastos,
} = require("../controllers/reportController");

router.get("/resumen", verifyToken, getResumen);
router.get("/resumen-cobrador", verifyToken, getResumenCobrador);
router.get("/resumen-gastos", verifyToken, getResumenGastos);

module.exports = router;