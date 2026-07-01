// src/controllers/dashboardController.js
const getSupabase = require('../config/supabaseClient');

const toDateOnly = (value) => {
  if (!value) return new Date().toISOString().split('T')[0];
  if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);
  return new Date(value).toISOString().split('T')[0];
};

const startOfDayIso = (date) => `${date}T00:00:00.000Z`;
const endOfDayIso = (date) => `${date}T23:59:59.999Z`;

// ────────────────────────────────────────────────────────────
// DASHBOARD ADMIN  —  Una sola llamada con todo lo importante
// ────────────────────────────────────────────────────────────
const getDashboardAdmin = async (req, res) => {
  const supabase = getSupabase();
  const fecha = toDateOnly(req.query.fecha);

  // Fechas para tendencia de 7 días
  const hace7dias = new Date();
  hace7dias.setDate(hace7dias.getDate() - 6);
  const fecha7dias = hace7dias.toISOString().split('T')[0];

  try {
    // Lanzar TODO en paralelo (más rápido)
    const [
      prestamosActivosRes,
      cobradoresRes,
      pagosHoyRes,
      pagosSemanaRes,
      gastosHoyRes,
      gastosSemanaRes,
      moraRes,
      observacionesRes,
      rutasRes,
      cajaHoyRes,
      clientesRes,
    ] = await Promise.all([
      // 1) Préstamos activos
      supabase
        .from('prestamos')
        .select('id, monto_prestado, monto_total, saldo_pendiente, cobrador_id, estado, fecha_fin')
        .in('estado', ['activo', 'mora']),

      // 2) Cobradores
      supabase
        .from('usuarios')
        .select('id, nombre, rol')
        .eq('rol', 'cobrador')
        .order('nombre'),

      // 3) Pagos del día
      supabase
        .from('pagos')
        .select('id, monto_pagado, cobrador_id, fecha_pago, prestamo_id')
        .gte('fecha_pago', startOfDayIso(fecha))
        .lte('fecha_pago', endOfDayIso(fecha)),

      // 4) Pagos últimos 7 días (para tendencia)
      supabase
        .from('pagos')
        .select('monto_pagado, fecha_pago')
        .gte('fecha_pago', startOfDayIso(fecha7dias)),

      // 5) Gastos del día
      supabase
        .from('gastos')
        .select('id, valor, tipo_gasto, cobrador_id')
        .eq('fecha', fecha),

      // 6) Gastos últimos 7 días
      supabase
        .from('gastos')
        .select('valor, fecha')
        .gte('fecha', fecha7dias),

      // 7) Préstamos en mora (top 10 por saldo)
      supabase
        .from('prestamos')
        .select(`
          id, cobrador_id, cliente_id, saldo_pendiente, monto_total, fecha_fin,
          clientes ( id, nombre, telefono )
        `)
        .eq('estado', 'mora')
        .order('saldo_pendiente', { ascending: false })
        .limit(10),

      // 8) Observaciones pendientes (últimas 5)
      supabase
        .from('observaciones')
        .select('id, descripcion, tipo, created_at, cobrador_id, usuarios!observaciones_cobrador_id_fkey(nombre)')
        .eq('resuelta', false)
        .order('created_at', { ascending: false })
        .limit(5),

      // 9) Rutas y relaciones
      supabase
        .from('cobrador_rutas')
        .select('cobrador_id, ruta_id, rutas(id, nombre)'),

      // 10) Caja del día
      supabase
        .from('caja_diaria')
        .select(`
          id, cobrador_id, base_entregada, total_cobrado, total_entregado, diferencia,
          usuarios!caja_diaria_cobrador_id_fkey(nombre)
        `)
        .eq('fecha', fecha),

      // 11) Clientes totales
      supabase
        .from('clientes')
        .select('id, cobrador_id, ruta_id'),
    ]);

    // Validar errores
    if (prestamosActivosRes.error) throw prestamosActivosRes.error;
    if (cobradoresRes.error) throw cobradoresRes.error;
    if (pagosHoyRes.error) throw pagosHoyRes.error;
    if (pagosSemanaRes.error) throw pagosSemanaRes.error;
    if (gastosHoyRes.error) throw gastosHoyRes.error;
    if (gastosSemanaRes.error) throw gastosSemanaRes.error;
    if (moraRes.error) throw moraRes.error;
    if (observacionesRes.error) throw observacionesRes.error;
    if (rutasRes.error) throw rutasRes.error;
    if (cajaHoyRes.error) throw cajaHoyRes.error;
    if (clientesRes.error) throw clientesRes.error;

    const prestamos = prestamosActivosRes.data ?? [];
    const cobradores = cobradoresRes.data ?? [];
    const pagosHoy = pagosHoyRes.data ?? [];
    const pagosSemana = pagosSemanaRes.data ?? [];
    const gastosHoy = gastosHoyRes.data ?? [];
    const gastosSemana = gastosSemanaRes.data ?? [];
    const mora = moraRes.data ?? [];
    const observaciones = observacionesRes.data ?? [];
    const relacionesRutas = rutasRes.data ?? [];
    const cajas = cajaHoyRes.data ?? [];
    const clientes = clientesRes.data ?? [];

    // ── KPIs globales ──────────────────────────────────────
    const totalPrestado = prestamos.reduce((s, p) => s + Number(p.monto_prestado || 0), 0);
    const totalCartera = prestamos.reduce((s, p) => s + Number(p.saldo_pendiente || 0), 0);
    const totalRecaudadoHoy = pagosHoy.reduce((s, p) => s + Number(p.monto_pagado || 0), 0);
    const totalGastosHoy = gastosHoy.reduce((s, g) => s + Number(g.valor || 0), 0);
    const utilidadHoy = totalRecaudadoHoy - totalGastosHoy;
    const totalClientes = clientes.length;
    const prestamosEnMora = mora.length;

    // ── Rutas por cobrador ─────────────────────────────────
    const rutasPorCobrador = {};
    for (const item of relacionesRutas) {
      if (!rutasPorCobrador[item.cobrador_id]) {
        rutasPorCobrador[item.cobrador_id] = [];
      }
      if (item.rutas) {
        rutasPorCobrador[item.cobrador_id].push({
          id: item.rutas.id,
          nombre: item.rutas.nombre,
        });
      }
    }

    // ── Pagos hoy por cobrador ─────────────────────────────
    const pagosHoyPorCobrador = {};
    for (const p of pagosHoy) {
      pagosHoyPorCobrador[p.cobrador_id] =
        (pagosHoyPorCobrador[p.cobrador_id] || 0) + Number(p.monto_pagado || 0);
    }

    // ── Mora por cobrador ─────────────────────────────────
    const moraPorCobrador = {};
    for (const m of mora) {
      moraPorCobrador[m.cobrador_id] = (moraPorCobrador[m.cobrador_id] || 0) + 1;
    }

    // ── Tendencia últimos 7 días (agrupada por día) ───────
    const tendencia = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const key = d.toISOString().split('T')[0];
      tendencia[key] = { fecha: key, cobrado: 0, gastos: 0 };
    }
    for (const p of pagosSemana) {
      const k = p.fecha_pago.split('T')[0];
      if (tendencia[k]) tendencia[k].cobrado += Number(p.monto_pagado || 0);
    }
    for (const g of gastosSemana) {
      const k = g.fecha;
      if (tendencia[k]) tendencia[k].gastos += Number(g.valor || 0);
    }
    const tendenciaArr = Object.values(tendencia);

    // ── Resumen por cobrador ───────────────────────────────
    const porCobrador = cobradores.map((c) => {
      const prestamosC = prestamos.filter((p) => String(p.cobrador_id) === String(c.id));
      const totalCobrado = pagosHoyPorCobrador[c.id] || 0;
      const enMora = moraPorCobrador[c.id] || 0;
      const totalCarteraC = prestamosC.reduce(
        (s, p) => s + Number(p.saldo_pendiente || 0), 0
      );
      const totalPrestadoC = prestamosC.reduce(
        (s, p) => s + Number(p.monto_prestado || 0), 0
      );
      const rutas = rutasPorCobrador[c.id] ?? [];
      // Caja del cobrador
      const cajaC = cajas.find((caja) => String(caja.cobrador_id) === String(c.id));

      return {
        id: c.id,
        nombre: c.nombre,
        rutas: rutas.map((r) => r.nombre),
        prestamos_activos: prestamosC.length,
        en_mora: enMora,
        total_prestado: totalPrestadoC,
        total_cartera: totalCarteraC,
        total_cobrado_hoy: totalCobrado,
        total_clientes: clientes.filter((cl) => String(cl.cobrador_id) === String(c.id)).length,
        caja: cajaC
          ? {
              id: cajaC.id,
              base_entregada: Number(cajaC.base_entregada) || 0,
              total_cobrado: Number(cajaC.total_cobrado) || 0,
              total_entregado: cajaC.total_entregado === null ? null : Number(cajaC.total_entregado),
              diferencia: cajaC.diferencia === null ? null : Number(cajaC.diferencia),
              cerrada: cajaC.total_entregado !== null,
            }
          : null,
      };
    });

    // Top cobradores del día
    const topCobradores = [...porCobrador]
      .sort((a, b) => b.total_cobrado_hoy - a.total_cobrado_hoy)
      .slice(0, 5);

    // Cobradores sin actividad hoy
    const cobradoresSinActividad = porCobrador.filter(
      (c) => c.total_cobrado_hoy === 0 && c.prestamos_activos > 0
    );

    // ── Top morosos ───────────────────────────────────────
    const topMorosos = mora.slice(0, 5).map((m) => ({
      id: m.id,
      cliente_id: m.cliente_id,
      cliente_nombre: m.clientes?.nombre ?? 'Sin nombre',
      cliente_telefono: m.clientes?.telefono ?? '',
      saldo_pendiente: Number(m.saldo_pendiente) || 0,
      monto_total: Number(m.monto_total) || 0,
      fecha_fin: m.fecha_fin,
    }));

    // ── Caja global del día ───────────────────────────────
    const cajaGlobal = {
      total_cobradores_con_caja: cajas.length,
      total_base_entregada: cajas.reduce((s, c) => s + (Number(c.base_entregada) || 0), 0),
      total_cobrado: cajas.reduce((s, c) => s + (Number(c.total_cobrado) || 0), 0),
      total_entregado: cajas.reduce((s, c) => s + (c.total_entregado === null ? 0 : Number(c.total_entregado)), 0),
      cajas_pendientes: cajas.filter((c) => c.total_entregado === null).length,
      cajas_cerradas: cajas.filter((c) => c.total_entregado !== null).length,
    };
    cajaGlobal.saldo_en_caja = cajaGlobal.total_base_entregada + cajaGlobal.total_cobrado - cajaGlobal.total_entregado;

    // ── Observaciones ─────────────────────────────────────
    const observacionesFmt = observaciones.map((o) => ({
      id: o.id,
      tipo: o.tipo,
      descripcion: o.descripcion,
      created_at: o.created_at,
      cobrador_nombre: o.usuarios?.nombre ?? 'Desconocido',
    }));

    return res.json({
      fecha,
      usuario: { rol: 'admin' },
      kpis: {
        total_prestado: totalPrestado,
        total_cartera: totalCartera,
        total_recaudado_hoy: totalRecaudadoHoy,
        total_gastos_hoy: totalGastosHoy,
        utilidad_hoy: utilidadHoy,
        total_clientes: totalClientes,
        prestamos_activos: prestamos.length,
        prestamos_en_mora: prestamosEnMora,
      },
      tendencia: tendenciaArr,
      caja_global: cajaGlobal,
      por_cobrador: porCobrador,
      top_cobradores: topCobradores,
      cobradores_sin_actividad: cobradoresSinActividad,
      top_morosos: topMorosos,
      observaciones_pendientes: observacionesFmt,
    });
  } catch (error) {
    console.error('Error getDashboardAdmin:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

// ────────────────────────────────────────────────────────────
// DASHBOARD COBRADOR  —  Una sola llamada
// ────────────────────────────────────────────────────────────
const getDashboardCobrador = async (req, res) => {
  const supabase = getSupabase();
  const userId = req.user.id;
  const fecha = toDateOnly(req.query.fecha);

  const hace7dias = new Date();
  hace7dias.setDate(hace7dias.getDate() - 6);
  const fecha7dias = hace7dias.toISOString().split('T')[0];

  try {
    const [
      usuarioRes,
      prestamosRes,
      pagosHoyRes,
      pagosSemanaRes,
      gastosHoyRes,
      cajaHoyRes,
      rutasRes,
      clientesRes,
      proximosVencerRes,
    ] = await Promise.all([
      supabase
        .from('usuarios')
        .select('id, nombre, rol')
        .eq('id', userId)
        .single(),

      supabase
        .from('prestamos')
        .select('id, monto_prestado, monto_total, saldo_pendiente, cuota_diaria, fecha_inicio, fecha_fin, estado, cliente_id')
        .eq('cobrador_id', userId)
        .in('estado', ['activo', 'mora', 'pagado']),

      supabase
        .from('pagos')
        .select('id, monto_pagado, fecha_pago, prestamo_id, prestamos(id, cliente_id, clientes(nombre, telefono))')
        .eq('cobrador_id', userId)
        .gte('fecha_pago', startOfDayIso(fecha))
        .lte('fecha_pago', endOfDayIso(fecha))
        .order('fecha_pago', { ascending: false }),

      supabase
        .from('pagos')
        .select('monto_pagado, fecha_pago')
        .eq('cobrador_id', userId)
        .gte('fecha_pago', startOfDayIso(fecha7dias)),

      supabase
        .from('gastos')
        .select('id, valor, tipo_gasto, fecha')
        .eq('cobrador_id', userId)
        .eq('fecha', fecha),

      supabase
        .from('caja_diaria')
        .select('id, base_entregada, total_cobrado, total_entregado, diferencia')
        .eq('cobrador_id', userId)
        .eq('fecha', fecha)
        .maybeSingle(),

      supabase
        .from('cobrador_rutas')
        .select('ruta_id, rutas(id, nombre)')
        .eq('cobrador_id', userId),

      supabase
        .from('clientes')
        .select('id, nombre, telefono, ruta_id')
        .eq('cobrador_id', userId),

      // Préstamos que vencen en próximos 3 días
      supabase
        .from('prestamos')
        .select(`
          id, saldo_pendiente, fecha_fin, cliente_id,
          clientes (id, nombre, telefono)
        `)
        .eq('cobrador_id', userId)
        .eq('estado', 'activo')
        .lte('fecha_fin', new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString())
        .order('fecha_fin', { ascending: true })
        .limit(10),
    ]);

    if (usuarioRes.error) throw usuarioRes.error;
    if (prestamosRes.error) throw prestamosRes.error;
    if (pagosHoyRes.error) throw pagosHoyRes.error;
    if (pagosSemanaRes.error) throw pagosSemanaRes.error;
    if (gastosHoyRes.error) throw gastosHoyRes.error;
    if (cajaHoyRes.error) throw cajaHoyRes.error;
    if (rutasRes.error) throw rutasRes.error;
    if (clientesRes.error) throw clientesRes.error;
    if (proximosVencerRes.error) throw proximosVencerRes.error;

    const prestamos = prestamosRes.data ?? [];
    const activos = prestamos.filter((p) => p.estado === 'activo' || p.estado === 'mora');
    const enMora = prestamos.filter((p) => p.estado === 'mora');
    const pagosHoy = pagosHoyRes.data ?? [];
    const pagosSemana = pagosSemanaRes.data ?? [];
    const gastosHoy = gastosHoyRes.data ?? [];
    const caja = cajaHoyRes.data;
    const rutas = (rutasRes.data ?? [])
      .map((r) => r.rutas)
      .filter(Boolean)
      .map((r) => ({ id: r.id, nombre: r.nombre }));

    // KPIs personales
    const miCartera = activos.reduce((s, p) => s + Number(p.saldo_pendiente || 0), 0);
    const totalPrestado = activos.reduce((s, p) => s + Number(p.monto_prestado || 0), 0);
    const totalRecaudadoHoy = pagosHoy.reduce((s, p) => s + Number(p.monto_pagado || 0), 0);
    const totalGastosHoy = gastosHoy.reduce((s, g) => s + Number(g.valor || 0), 0);
    const utilidadHoy = totalRecaudadoHoy - totalGastosHoy;
    const cantidadPagosHoy = pagosHoy.length;
    const metaDiaria = activos.reduce((s, p) => s + Number(p.cuota_diaria || 0), 0);
    const progresoMeta = metaDiaria > 0 ? (totalRecaudadoHoy / metaDiaria) * 100 : 0;

    // Tendencia semanal del cobrador
    const tendencia = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const key = d.toISOString().split('T')[0];
      tendencia[key] = { fecha: key, cobrado: 0 };
    }
    for (const p of pagosSemana) {
      const k = p.fecha_pago.split('T')[0];
      if (tendencia[k]) tendencia[k].cobrado += Number(p.monto_pagado || 0);
    }
    const tendenciaArr = Object.values(tendencia);

    // Caja personal
    const miCaja = caja
      ? {
          id: caja.id,
          base_entregada: Number(caja.base_entregada) || 0,
          total_cobrado: Number(caja.total_cobrado) || 0,
          total_entregado: caja.total_entregado === null ? null : Number(caja.total_entregado),
          diferencia: caja.diferencia === null ? null : Number(caja.diferencia),
          cerrada: caja.total_entregado !== null,
        }
      : null;

    // Clientes prioritarios (en mora)
    const clientesPrioritarios = enMora.slice(0, 10).map((p) => ({
      prestamo_id: p.id,
      cliente_id: p.cliente_id,
      saldo: Number(p.saldo_pendiente) || 0,
      fecha_fin: p.fecha_fin,
    }));

    // Préstamos que están por vencer
    const proximosVencer = (proximosVencerRes.data ?? []).map((p) => ({
      prestamo_id: p.id,
      cliente_id: p.cliente_id,
      cliente_nombre: p.clientes?.nombre ?? 'Sin nombre',
      cliente_telefono: p.clientes?.telefono ?? '',
      saldo: Number(p.saldo_pendiente) || 0,
      fecha_fin: p.fecha_fin,
    }));

    return res.json({
      fecha,
      usuario: {
        id: usuarioRes.data.id,
        nombre: usuarioRes.data.nombre,
        rol: usuarioRes.data.rol,
      },
      kpis: {
        mi_cartera: miCartera,
        total_prestado: totalPrestado,
        total_recaudado_hoy: totalRecaudadoHoy,
        total_gastos_hoy: totalGastosHoy,
        utilidad_hoy: utilidadHoy,
        prestamos_activos: activos.length,
        prestamos_en_mora: enMora.length,
        pagos_hoy: cantidadPagosHoy,
        meta_diaria: metaDiaria,
        progreso_meta: progresoMeta,
      },
      tendencia: tendenciaArr,
      rutas: rutas,
      mi_caja: miCaja,
      pagos_hoy_detalle: pagosHoy.map((p) => ({
        id: p.id,
        monto: Number(p.monto_pagado) || 0,
        fecha_pago: p.fecha_pago,
        cliente_nombre: p.prestamos?.clientes?.nombre ?? 'Cliente',
        prestamo_id: p.prestamo_id,
      })),
      clientes_en_mora: clientesPrioritarios,
      proximos_a_vencer: proximosVencer,
    });
  } catch (error) {
    console.error('Error getDashboardCobrador:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

// src/controllers/dashboardController.js
// (AGREGA estas líneas al final del archivo, ANTES del module.exports)

/**
 * Obtiene la(s) cuota(s) que el cobrador debe cobrar HOY
 * Devuelve un resumen de qué préstamos tienen pagos programados para hoy
 */
const getCuotasDelDia = async (req, res) => {
  const supabase = getSupabase();
  const userId = req.user.id;
  const fecha = toDateOnly(req.query.fecha);

  try {
    // 1. Buscar pagos programados para hoy de préstamos activos del cobrador
    const { data: pagosProgramados, error: ppError } = await supabase
      .from('pagos_programados')
      .select(`
        id, prestamo_id, numero_pago, fecha_programada, monto_esperado, pagado,
        prestamos!inner (
          id, estado, monto_total, saldo_pendiente, fecha_fin,
          clientes ( id, nombre, telefono, ruta_id, rutas(nombre) )
        )
      `)
      .eq('prestamos.cobrador_id', userId)
      .eq('fecha_programada', fecha)
      .eq('pagado', false)
      .in('prestamos.estado', ['activo', 'mora'])
      .order('numero_pago');

    if (ppError) {
      console.log('Tabla pagos_programados no existe, calculando en vivo...');
    }

    let cuotas = [];

    if (pagosProgramados && pagosProgramados.length > 0) {
      // Usar la tabla de pagos programados
      cuotas = pagosProgramados.map((pp) => ({
        pago_programado_id: pp.id,
        prestamo_id: pp.prestamo_id,
        numero_pago: pp.numero_pago,
        fecha_programada: pp.fecha_programada,
        monto_esperado: Number(pp.monto_esperado) || 0,
        cliente_nombre: pp.prestamos?.clientes?.nombre ?? 'Sin nombre',
        cliente_telefono: pp.prestamos?.clientes?.telefono ?? '',
        ruta_nombre: pp.prestamos?.clientes?.rutas?.nombre ?? '',
        estado_prestamo: pp.prestamos?.estado ?? 'activo',
        saldo_pendiente: Number(pp.prestamos?.saldo_pendiente) || 0,
      }));
    } else {
      // Calcular en vivo basándose en frecuencia
      const { data: prestamos, error: pError } = await supabase
        .from('prestamos')
        .select(`
          id, estado, monto_total, saldo_pendiente, cuota_diaria,
          fecha_inicio, fecha_fin, frecuencia, total_pagos_programados, pagos_realizados,
          clientes ( id, nombre, telefono, ruta_id, rutas(nombre) )
        `)
        .eq('cobrador_id', userId)
        .in('estado', ['activo', 'mora']);

      if (pError) throw pError;

      const { calcularCuota, generarFechasPago, getInfoFrecuencia } = require('../utils/frecuenciaHelper');
      const targetDate = new Date(fecha + 'T00:00:00');

      for (const p of prestamos ?? []) {
        const cfg = getInfoFrecuencia(p.frecuencia || 'diario');
        const numPagos = p.total_pagos_programados || cfg.pagosPorPlazo(
          Math.ceil((new Date(p.fecha_fin) - new Date(p.fecha_inicio)) / (1000 * 60 * 60 * 24))
        );
        const fechas = generarFechasPago(new Date(p.fecha_inicio), p.frecuencia || 'diario', numPagos);

        // Buscar si la fecha de hoy está en las fechas de pago
        const idxHoy = fechas.findIndex(f =>
          f.toISOString().split('T')[0] === fecha
        );

        if (idxHoy >= 0) {
          const numeroPago = idxHoy + 1;
          // Verificar si este pago ya fue hecho (chequear en tabla pagos)
          const { data: pagosHechos, error: phError } = await supabase
            .from('pagos')
            .select('id')
            .eq('prestamo_id', p.id)
            .gte('fecha_pago', `${fecha}T00:00:00`)
            .lte('fecha_pago', `${fecha}T23:59:59`);

          if (phError) throw phError;

          // Solo agregar si no se ha pagado hoy
          if (!pagosHechos || pagosHechos.length === 0) {
            cuotas.push({
              prestamo_id: p.id,
              numero_pago: numeroPago,
              fecha_programada: fecha,
              monto_esperado: p.cuota_diaria,
              cliente_nombre: p.clientes?.nombre ?? 'Sin nombre',
              cliente_telefono: p.clientes?.telefono ?? '',
              ruta_nombre: p.clientes?.rutas?.nombre ?? '',
              estado_prestamo: p.estado,
              saldo_pendiente: Number(p.saldo_pendiente) || 0,
            });
          }
        }
      }
    }

    const totalCuotas = cuotas.length;
    const totalEsperado = cuotas.reduce((s, c) => s + c.monto_esperado, 0);
    const totalPagadoHoy = 0; // Se calcula en el cliente

    return res.json({
      fecha,
      resumen: {
        total_cuotas_pendientes: totalCuotas,
        total_esperado: totalEsperado,
        total_pagado_hoy: totalPagadoHoy,
      },
      cuotas,
    });
  } catch (error) {
    console.error('Error getCuotasDelDia:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

// Reemplaza el module.exports al final:
module.exports = { getDashboardAdmin, getDashboardCobrador, getCuotasDelDia };
