const supabase = require('../config/supabaseClient');

// ── EXISTENTE ─────────────────────────────────────────────────
const getResumen = async (req, res) => {
  try {
    const { data: totalData, error: totalError } = await supabase
      .from('prestamos')
      .select('monto_prestado, saldo_pendiente, cobrador_id')
      .eq('estado', 'activo');

    if (totalError) throw totalError;

    const { data: cobradores, error: cobError } = await supabase
      .from('usuarios')
      .select('id, nombre, ruta_id')
      .eq('rol', 'cobrador');

    if (cobError) throw cobError;

    const totalPrestado  = totalData.reduce((sum, p) => sum + parseFloat(p.monto_prestado),  0);
    const totalPendiente = totalData.reduce((sum, p) => sum + parseFloat(p.saldo_pendiente), 0);

    const porCobrador = cobradores.map(cobrador => {
      const prestamosCobrador = totalData.filter(p => p.cobrador_id === cobrador.id);
      return {
        nombre:           cobrador.nombre,
        ruta_id:          cobrador.ruta_id,
        total_prestado:   prestamosCobrador.reduce((sum, p) => sum + parseFloat(p.monto_prestado),  0),
        total_pendiente:  prestamosCobrador.reduce((sum, p) => sum + parseFloat(p.saldo_pendiente), 0),
        cantidad_prestamos: prestamosCobrador.length,
      };
    });

    res.json({
      total_general_prestado:    totalPrestado,
      total_general_pendiente:   totalPendiente,
      cantidad_prestamos_activos: totalData.length,
      por_cobrador:              porCobrador,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ── NUEVO ─────────────────────────────────────────────────────
const getResumenCobrador = async (req, res) => {
  try {
    const userId = req.user.id;

    // Préstamos activos del cobrador
    const { data: prestamos, error: errorPrestamos } = await supabase
      .from('prestamos')
      .select('id, monto_prestado, saldo_pendiente')
      .eq('cobrador_id', userId)
      .eq('estado', 'activo');

    if (errorPrestamos) throw errorPrestamos;

    // ✅ Pagos filtrados directo por cobrador_id (columna que ya existe)
    const { data: pagos, error: errorPagos } = await supabase
      .from('pagos')
      .select('monto_pagado')
      .eq('cobrador_id', userId);

    if (errorPagos) throw errorPagos;

    // ✅ Mora: préstamos activos con saldo_pendiente > 0
    // (quitamos fecha_vencimiento porque no existe esa columna)
    const { data: mora, error: errorMora } = await supabase
      .from('prestamos')
      .select('id')
      .eq('cobrador_id', userId)
      .eq('estado', 'activo')
      .gt('saldo_pendiente', 0);

    if (errorMora) throw errorMora;

    // Nombre del cobrador
    const { data: usuario, error: errorUsuario } = await supabase
      .from('usuarios')
      .select('nombre')
      .eq('id', userId)
      .single();

    if (errorUsuario) throw errorUsuario;

    const totalPrestado  = prestamos.reduce((sum, p) => sum + parseFloat(p.monto_prestado  || 0), 0);
    const totalPendiente = prestamos.reduce((sum, p) => sum + parseFloat(p.saldo_pendiente || 0), 0);
    const totalRecaudado = pagos.reduce((sum, p)     => sum + parseFloat(p.monto_pagado    || 0), 0);

    res.json({
      nombre:                     usuario.nombre,
      cantidad_prestamos_activos: prestamos.length,
      cantidad_en_mora:           mora.length,
      total_prestado:             totalPrestado,
      total_pendiente:            totalPendiente,
      total_recaudado:            totalRecaudado,
    });
  } catch (error) {
    console.error('Error getResumenCobrador:', error);
    res.status(400).json({ error: error.message });
  }
};

// ── NUEVO ─────────────────────────────────────────────────────
const getResumenGastos = async (req, res) => {
  try {
    if (req.user.rol !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { data: gastos, error } = await supabase
      .from('gastos')
      .select('valor, tipo_gasto');

    if (error) throw error;

    // Agrupar por tipo
    const porTipoMap = {};
    gastos.forEach((g) => {
      const tipo = g.tipo_gasto;
      porTipoMap[tipo] = (porTipoMap[tipo] || 0) + parseFloat(g.valor || 0);
    });

    const porTipo = Object.entries(porTipoMap)
      .map(([tipo_gasto, total]) => ({ tipo_gasto, total }))
      .sort((a, b) => b.total - a.total); // mayor a menor

    res.json({
      total_gastos:    gastos.reduce((sum, g) => sum + parseFloat(g.valor || 0), 0),
      cantidad_gastos: gastos.length,
      por_tipo:        porTipo,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports = { getResumen, getResumenCobrador, getResumenGastos };