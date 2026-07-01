const getSupabase = require("../config/supabaseClient");

const toDateOnly = (value) => {
  if (!value) return new Date().toISOString().split("T")[0];
  if (typeof value === "string" && value.length >= 10) return value.slice(0, 10);
  return new Date(value).toISOString().split("T")[0];
};

const startOfDayIso = (date) => `${date}T00:00:00.000Z`;
const endOfDayIso = (date) => `${date}T23:59:59.999Z`;

const getResumen = async (req, res) => {
  const supabase = getSupabase();
  const fecha = toDateOnly(req.query.fecha);

  try {
    const [
      prestamosRes,
      cobradoresRes,
      rutasRes,
      pagosHoyRes,
      gastosHoyRes,
      moraRes,
    ] = await Promise.all([
      supabase
        .from("prestamos")
        .select("id, monto_prestado, monto_total, saldo_pendiente, cobrador_id, estado")
        .in("estado", ["activo", "mora"]),
      supabase
        .from("usuarios")
        .select("id, nombre")
        .eq("rol", "cobrador")
        .order("nombre", { ascending: true }),
      supabase
        .from("cobrador_rutas")
        .select("cobrador_id, ruta_id, rutas(id, nombre)"),
      supabase
        .from("pagos")
        .select("id, monto_pagado, cobrador_id, fecha_pago")
        .gte("fecha_pago", startOfDayIso(fecha))
        .lte("fecha_pago", endOfDayIso(fecha)),
      supabase
        .from("gastos")
        .select("id, valor, tipo_gasto, cobrador_id, fecha")
        .eq("fecha", fecha),
      supabase
        .from("prestamos")
        .select("id, cobrador_id")
        .eq("estado", "mora"),
    ]);

    if (prestamosRes.error) throw prestamosRes.error;
    if (cobradoresRes.error) throw cobradoresRes.error;
    if (rutasRes.error) throw rutasRes.error;
    if (pagosHoyRes.error) throw pagosHoyRes.error;
    if (gastosHoyRes.error) throw gastosHoyRes.error;
    if (moraRes.error) throw moraRes.error;

    const prestamos = prestamosRes.data ?? [];
    const cobradores = cobradoresRes.data ?? [];
    const relacionesRutas = rutasRes.data ?? [];
    const pagosHoy = pagosHoyRes.data ?? [];
    const gastosHoy = gastosHoyRes.data ?? [];
    const mora = moraRes.data ?? [];

    const totalGeneralPrestado = prestamos.reduce((s, p) => s + Number(p.monto_prestado || 0), 0);
    const totalGeneralCapitalColocado = prestamos.reduce((s, p) => s + Number(p.monto_total || 0), 0);
    const totalGeneralPendiente = prestamos.reduce((s, p) => s + Number(p.saldo_pendiente || 0), 0);
    const totalRecaudadoHoy = pagosHoy.reduce((s, p) => s + Number(p.monto_pagado || 0), 0);
    const totalGastosHoy = gastosHoy.reduce((s, g) => s + Number(g.valor || 0), 0);

    const rutasPorCobrador = {};
    for (const item of relacionesRutas) {
      const key = item.cobrador_id;
      if (!rutasPorCobrador[key]) rutasPorCobrador[key] = [];
      if (item.rutas) {
        rutasPorCobrador[key].push({
          id: item.rutas.id,
          nombre: item.rutas.nombre,
        });
      }
    }

    const moraPorCobrador = {};
    for (const item of mora) {
      const key = item.cobrador_id;
      moraPorCobrador[key] = (moraPorCobrador[key] || 0) + 1;
    }

    const pagosHoyPorCobrador = {};
    for (const pago of pagosHoy) {
      const key = pago.cobrador_id;
      pagosHoyPorCobrador[key] = (pagosHoyPorCobrador[key] || 0) + Number(pago.monto_pagado || 0);
    }

    const porCobrador = cobradores.map((cobrador) => {
      const prestamosCobrador = prestamos.filter(
        (p) => String(p.cobrador_id) === String(cobrador.id)
      );

      const totalPrestado = prestamosCobrador.reduce(
        (s, p) => s + Number(p.monto_prestado || 0),
        0
      );

      const totalPendiente = prestamosCobrador.reduce(
        (s, p) => s + Number(p.saldo_pendiente || 0),
        0
      );

      const totalMontoTotal = prestamosCobrador.reduce(
        (s, p) => s + Number(p.monto_total || 0),
        0
      );

      const rutas = rutasPorCobrador[cobrador.id] ?? [];

      return {
        cobrador_id: cobrador.id,
        nombre: cobrador.nombre,
        rutas,
        ruta_ids: rutas.map((r) => r.id),
        ruta_nombres: rutas.map((r) => r.nombre),
        total_prestado: totalPrestado,
        total_monto_total: totalMontoTotal,
        total_pendiente: totalPendiente,
        total_recaudado_hoy: pagosHoyPorCobrador[cobrador.id] || 0,
        cantidad_prestamos: prestamosCobrador.length,
        cantidad_en_mora: moraPorCobrador[cobrador.id] || 0,
      };
    });

    return res.json({
      fecha,
      total_general_prestado: totalGeneralPrestado,
      total_general_monto_total: totalGeneralCapitalColocado,
      total_general_pendiente: totalGeneralPendiente,
      total_recaudado_hoy: totalRecaudadoHoy,
      total_gastos_hoy: totalGastosHoy,
      utilidad_hoy_estimada: totalRecaudadoHoy - totalGastosHoy,
      cantidad_prestamos_activos: prestamos.length,
      cantidad_en_mora: mora.length,
      por_cobrador: porCobrador,
    });
  } catch (error) {
    console.error("Error getResumen:", error.message);
    return res.status(400).json({ error: error.message });
  }
};

const getResumenCobrador = async (req, res) => {
  const supabase = getSupabase();
  const userId = req.user.id;
  const fecha = toDateOnly(req.query.fecha);

  try {
    const [prestamosRes, pagosHoyRes, usuarioRes, rutasRes, moraRes, gastosRes] =
      await Promise.all([
        supabase
          .from("prestamos")
          .select("id, monto_prestado, monto_total, saldo_pendiente, estado")
          .eq("cobrador_id", userId)
          .in("estado", ["activo", "mora"]),
        supabase
          .from("pagos")
          .select("monto_pagado")
          .eq("cobrador_id", userId)
          .gte("fecha_pago", startOfDayIso(fecha))
          .lte("fecha_pago", endOfDayIso(fecha)),
        supabase
          .from("usuarios")
          .select("nombre")
          .eq("id", userId)
          .single(),
        supabase
          .from("cobrador_rutas")
          .select("ruta_id, rutas(id, nombre)")
          .eq("cobrador_id", userId),
        supabase
          .from("prestamos")
          .select("id")
          .eq("cobrador_id", userId)
          .eq("estado", "mora"),
        supabase
          .from("gastos")
          .select("valor")
          .eq("cobrador_id", userId)
          .eq("fecha", fecha),
      ]);

    if (prestamosRes.error) throw prestamosRes.error;
    if (pagosHoyRes.error) throw pagosHoyRes.error;
    if (usuarioRes.error) throw usuarioRes.error;
    if (rutasRes.error) throw rutasRes.error;
    if (moraRes.error) throw moraRes.error;
    if (gastosRes.error) throw gastosRes.error;

    const prestamos = prestamosRes.data ?? [];
    const pagosHoy = pagosHoyRes.data ?? [];
    const rutas =
      (rutasRes.data ?? [])
        .map((item) => item.rutas)
        .filter(Boolean)
        .map((ruta) => ({ id: ruta.id, nombre: ruta.nombre })) ?? [];

    const totalPrestado = prestamos.reduce((s, p) => s + Number(p.monto_prestado || 0), 0);
    const totalMontoTotal = prestamos.reduce((s, p) => s + Number(p.monto_total || 0), 0);
    const totalPendiente = prestamos.reduce((s, p) => s + Number(p.saldo_pendiente || 0), 0);
    const totalRecaudadoHoy = pagosHoy.reduce((s, p) => s + Number(p.monto_pagado || 0), 0);
    const totalGastosHoy = (gastosRes.data ?? []).reduce((s, g) => s + Number(g.valor || 0), 0);

    return res.json({
      fecha,
      nombre: usuarioRes.data.nombre,
      cantidad_prestamos_activos: prestamos.length,
      cantidad_en_mora: (moraRes.data ?? []).length,
      total_prestado: totalPrestado,
      total_monto_total: totalMontoTotal,
      total_pendiente: totalPendiente,
      total_recaudado_hoy: totalRecaudadoHoy,
      total_gastos_hoy: totalGastosHoy,
      utilidad_hoy_estimada: totalRecaudadoHoy - totalGastosHoy,
      rutas,
      ruta_ids: rutas.map((r) => r.id),
      ruta_nombres: rutas.map((r) => r.nombre),
    });
  } catch (error) {
    console.error("Error getResumenCobrador:", error.message);
    return res.status(400).json({ error: error.message });
  }
};

const getResumenGastos = async (req, res) => {
  const supabase = getSupabase();
  const fecha = toDateOnly(req.query.fecha);

  try {
    if (req.user.rol !== "admin") {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    const { data, error } = await supabase
      .from("gastos")
      .select("valor, tipo_gasto")
      .eq("fecha", fecha);

    if (error) throw error;

    const gastos = data ?? [];
    const porTipoMap = {};

    for (const g of gastos) {
      const tipo = g.tipo_gasto || "Sin tipo";
      porTipoMap[tipo] = (porTipoMap[tipo] || 0) + Number(g.valor || 0);
    }

    const porTipo = Object.entries(porTipoMap)
      .map(([tipo_gasto, total]) => ({ tipo_gasto, total }))
      .sort((a, b) => b.total - a.total);

    return res.json({
      fecha,
      total_gastos: gastos.reduce((s, g) => s + Number(g.valor || 0), 0),
      cantidad_gastos: gastos.length,
      por_tipo: porTipo,
    });
  } catch (error) {
    console.error("Error getResumenGastos:", error.message);
    return res.status(400).json({ error: error.message });
  }
};

module.exports = {
  getResumen,
  getResumenCobrador,
  getResumenGastos,
};