const getSupabase = require('../config/supabaseClient');

const getResumen = async (req, res) => {
  const supabase = getSupabase();

  try {
    const { data: totalData, error: totalError } = await supabase
      .from('prestamos')
      .select('monto_prestado, saldo_pendiente, cobrador_id')
      .eq('estado', 'activo');

    if (totalError) throw totalError;

    const { data: cobradores, error: cobError } = await supabase
      .from('usuarios')
      .select('id, nombre')
      .eq('rol', 'cobrador')
      .order('nombre', { ascending: true });

    if (cobError) throw cobError;

    const { data: cobradorRutas, error: rutasError } = await supabase
      .from('cobrador_rutas')
      .select(`
        cobrador_id,
        ruta_id,
        rutas (
          id,
          nombre
        )
      `);

    if (rutasError) throw rutasError;

    const totalPrestado = (totalData ?? []).reduce(
      (sum, p) => sum + Number(p.monto_prestado || 0),
      0
    );

    const totalPendiente = (totalData ?? []).reduce(
      (sum, p) => sum + Number(p.saldo_pendiente || 0),
      0
    );

    const rutasPorCobrador = {};
    for (const item of cobradorRutas ?? []) {
      const key = item.cobrador_id;
      if (!rutasPorCobrador[key]) rutasPorCobrador[key] = [];
      if (item.rutas) {
        rutasPorCobrador[key].push({
          id: item.rutas.id,
          nombre: item.rutas.nombre,
        });
      }
    }

    const porCobrador = (cobradores ?? []).map((cobrador) => {
      const prestamosCobrador = (totalData ?? []).filter(
        (p) => String(p.cobrador_id) === String(cobrador.id)
      );

      const total_prestado = prestamosCobrador.reduce(
        (sum, p) => sum + Number(p.monto_prestado || 0),
        0
      );

      const total_pendiente = prestamosCobrador.reduce(
        (sum, p) => sum + Number(p.saldo_pendiente || 0),
        0
      );

      const rutas = rutasPorCobrador[cobrador.id] ?? [];

      return {
        cobrador_id: cobrador.id,
        nombre: cobrador.nombre,
        rutas,
        ruta_ids: rutas.map((r) => r.id),
        ruta_nombres: rutas.map((r) => r.nombre),
        total_prestado,
        total_pendiente,
        cantidad_prestamos: prestamosCobrador.length,
      };
    });

    return res.json({
      total_general_prestado: totalPrestado,
      total_general_pendiente: totalPendiente,
      cantidad_prestamos_activos: (totalData ?? []).length,
      por_cobrador: porCobrador,
    });
  } catch (error) {
    console.error('Error getResumen:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

const getResumenCobrador = async (req, res) => {
  const supabase = getSupabase();

  try {
    const userId = req.user.id;

    const { data: prestamos, error: errorPrestamos } = await supabase
      .from('prestamos')
      .select('id, monto_prestado, saldo_pendiente')
      .eq('cobrador_id', userId)
      .eq('estado', 'activo');

    if (errorPrestamos) throw errorPrestamos;

    const { data: pagos, error: errorPagos } = await supabase
      .from('pagos')
      .select('monto_pagado')
      .eq('cobrador_id', userId);

    if (errorPagos) throw errorPagos;

    const { data: mora, error: errorMora } = await supabase
      .from('prestamos')
      .select('id')
      .eq('cobrador_id', userId)
      .eq('estado', 'activo')
      .gt('saldo_pendiente', 0);

    if (errorMora) throw errorMora;

    const { data: usuario, error: errorUsuario } = await supabase
      .from('usuarios')
      .select('nombre')
      .eq('id', userId)
      .single();

    if (errorUsuario) throw errorUsuario;

    const { data: rutasAsignadas, error: rutasError } = await supabase
      .from('cobrador_rutas')
      .select(`
        ruta_id,
        rutas (
          id,
          nombre
        )
      `)
      .eq('cobrador_id', userId);

    if (rutasError) throw rutasError;

    const totalPrestado = (prestamos ?? []).reduce(
      (sum, p) => sum + Number(p.monto_prestado || 0),
      0
    );

    const totalPendiente = (prestamos ?? []).reduce(
      (sum, p) => sum + Number(p.saldo_pendiente || 0),
      0
    );

    const totalRecaudado = (pagos ?? []).reduce(
      (sum, p) => sum + Number(p.monto_pagado || 0),
      0
    );

    const rutas = (rutasAsignadas ?? [])
      .map((item) => item.rutas)
      .filter(Boolean)
      .map((ruta) => ({
        id: ruta.id,
        nombre: ruta.nombre,
      }));

    return res.json({
      nombre: usuario.nombre,
      cantidad_prestamos_activos: (prestamos ?? []).length,
      cantidad_en_mora: (mora ?? []).length,
      total_prestado: totalPrestado,
      total_pendiente: totalPendiente,
      total_recaudado: totalRecaudado,
      rutas,
      ruta_ids: rutas.map((r) => r.id),
      ruta_nombres: rutas.map((r) => r.nombre),
    });
  } catch (error) {
    console.error('Error getResumenCobrador:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

const getResumenGastos = async (req, res) => {
  const supabase = getSupabase();

  try {
    if (req.user.rol !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { data: gastos, error } = await supabase
      .from('gastos')
      .select('valor, tipo_gasto');

    if (error) throw error;

    const porTipoMap = {};
    for (const g of gastos ?? []) {
      const tipo = g.tipo_gasto || 'Sin tipo';
      porTipoMap[tipo] = (porTipoMap[tipo] || 0) + Number(g.valor || 0);
    }

    const porTipo = Object.entries(porTipoMap)
      .map(([tipo_gasto, total]) => ({ tipo_gasto, total }))
      .sort((a, b) => b.total - a.total);

    return res.json({
      total_gastos: (gastos ?? []).reduce(
        (sum, g) => sum + Number(g.valor || 0),
        0
      ),
      cantidad_gastos: (gastos ?? []).length,
      por_tipo: porTipo,
    });
  } catch (error) {
    console.error('Error getResumenGastos:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

module.exports = {
  getResumen,
  getResumenCobrador,
  getResumenGastos,
};