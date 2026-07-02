// src/controllers/loanController.js
const getSupabase = require('../config/supabaseClient');
const { calcularCuota, generarFechasPago, getInfoFrecuencia } = require('../utils/frecuenciaHelper');

const createLoan = async (req, res) => {
  const supabase = getSupabase();
  const {
    clientenombre, clientetelefono, clientedireccion,
    montoprestado, montototal, diasplazo,
    cobradorid, rutaid, rutanombre,
    frecuencia = 'diario',
  } = req.body;

  const responsableid = req.user.rol === 'admin' ? cobradorid : req.user.id;
  const montoPrestado = Number(montoprestado);
  const montoTotalManual = (montototal === null || montototal === undefined) ? null : Number(montototal);
  const diasPlazo = Number(diasplazo);

  if (!['diario', 'semanal', 'quincenal', 'mensual'].includes(frecuencia)) {
    return res.status(400).json({ error: 'frecuencia debe ser: diario, semanal, quincenal o mensual' });
  }

  const nombreTrimmed = (clientenombre ?? '').replace(/\s+/g, ' ').trim();
  if (!nombreTrimmed || nombreTrimmed.length < 3)
    return res.status(400).json({ error: 'clientenombre es requerido (mín. 3 caracteres)' });

  if (!responsableid)
    return res.status(400).json({ error: 'cobradorid es requerido' });

  if (isNaN(montoPrestado) || montoPrestado <= 0)
    return res.status(400).json({ error: 'montoprestado inválido' });

  if (isNaN(diasPlazo) || diasPlazo < 7 || diasPlazo > 365)
    return res.status(400).json({ error: 'El plazo debe ser entre 7 y 365 días' });

  if (montoTotalManual !== null && (isNaN(montoTotalManual) || montoTotalManual <= montoPrestado))
    return res.status(400).json({ error: 'montototal debe ser mayor que montoprestado' });

  try {
    let rutaIdFinal = rutaid ?? null;

    if (!rutaIdFinal && rutanombre) {
      const { data: rutaExistente } = await supabase
        .from('rutas').select('id').ilike('nombre', rutanombre).maybeSingle();
      if (rutaExistente) {
        rutaIdFinal = rutaExistente.id;
      } else {
        const { data: nuevaRuta, error: rutaInsertError } = await supabase
          .from('rutas').insert({ nombre: rutanombre }).select().single();
        if (rutaInsertError) throw rutaInsertError;
        rutaIdFinal = nuevaRuta.id;
      }
    }

    if (rutaIdFinal) {
      await supabase.from('cobrador_rutas').upsert({
        cobrador_id: responsableid,
        ruta_id: rutaIdFinal,
      }, { onConflict: 'cobrador_id,ruta_id', ignoreDuplicates: true });
    }

    const { data: clienteData, error: clienteError } = await supabase
      .from('clientes')
      .insert({
        nombre: nombreTrimmed,
        telefono: clientetelefono ?? null,
        direccion: clientedireccion ?? null,
        cobrador_id: responsableid,
        ruta_id: rutaIdFinal,
      })
      .select()
      .single();

    if (clienteError) throw clienteError;

    const montoTotalFinal = montoTotalManual !== null ? montoTotalManual : montoPrestado * 1.2;
    const cuotaPorPeriodo = calcularCuota(montoTotalFinal, diasPlazo, frecuencia);
    const fechaInicio = new Date();
    const fechaFin = new Date();
    fechaFin.setDate(fechaInicio.getDate() + diasPlazo);

    const cfg = getInfoFrecuencia(frecuencia);
    const numPagos = cfg.pagosPorPlazo(diasPlazo);
    const fechasPago = generarFechasPago(fechaInicio, frecuencia, diasPlazo);

    const { data: prestamoData, error: prestamoError } = await supabase
      .from('prestamos')
      .insert({
        cliente_id: clienteData.id,
        cobrador_id: responsableid,
        monto_prestado: montoPrestado,
        monto_total: montoTotalFinal,
        saldo_pendiente: montoTotalFinal,
        cuota_diaria: cuotaPorPeriodo,
        fecha_inicio: fechaInicio.toISOString(),
        fecha_fin: fechaFin.toISOString(),
        estado: 'activo',
        frecuencia: frecuencia,
        total_pagos_programados: numPagos,
        pagos_realizados: 0,
      })
      .select()
      .single();

    if (prestamoError) throw prestamoError;

    const pagosProgramados = fechasPago.map((fecha, idx) => ({
      prestamo_id: prestamoData.id,
      numero_pago: idx + 1,
      fecha_programada: fecha.toISOString().split('T')[0],
      monto_esperado: cuotaPorPeriodo,
      pagado: false,
    }));

    try {
      await supabase.from('pagos_programados').insert(pagosProgramados);
    } catch (_) {}

    return res.status(201).json({
      message: 'Préstamo creado exitosamente',
      cliente: clienteData,
      prestamo: prestamoData,
      frecuencia: {
        tipo: frecuencia,
        label: cfg.label,
        cuota_por_periodo: cuotaPorPeriodo,
        total_pagos: numPagos,
        fechas_pago: fechasPago.map(f => f.toISOString().split('T')[0]),
      },
    });
  } catch (error) {
    console.error('Error createLoan:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

const importarPrestamos = async (req, res) => {
  const supabase = getSupabase();
  const prestamos = req.body;

  if (!Array.isArray(prestamos) || prestamos.length === 0)
    return res.status(400).json({ error: 'Debes enviar un array de préstamos' });

  const creados = [];
  const errores = [];

  for (let i = 0; i < prestamos.length; i++) {
    const p = prestamos[i];
    const fila = p._fila ?? (i + 2);
    try {
      const responsableid = req.user.rol === 'admin'
        ? (p.cobrador_id ?? p.cobradorid ?? req.user.id)
        : req.user.id;

      const montoPrestado = Number(p.monto_prestado ?? p.montoprestado);
      const montoTotalRaw = p.monto_total ?? p.montototal;
      const montoTotalFinal = !montoTotalRaw ? montoPrestado * 1.2 : Number(montoTotalRaw);
      const diasPlazo = Number(p.dias_plazo ?? p.diasplazo ?? 30);
      const frecuencia = p.frecuencia ?? 'diario';
      const nombreTrimmed = String(p.clientenombre ?? '').replace(/\s+/g, ' ').trim();

      if (!['diario', 'semanal', 'quincenal', 'mensual'].includes(frecuencia)) {
        throw new Error(`frecuencia inválida: ${frecuencia}`);
      }

      if (!nombreTrimmed || nombreTrimmed.length < 3) throw new Error('clientenombre inválido');
      if (isNaN(montoPrestado) || montoPrestado <= 0) throw new Error('montoprestado inválido');
      if (isNaN(diasPlazo) || diasPlazo < 7 || diasPlazo > 365)
        throw new Error('diasplazo debe ser entre 7 y 365');

      let rutaIdFinal = p.ruta_id ?? p.rutaid ?? null;
      const nombreRuta = p.ruta_nombre ?? p.rutanombre;

      if (!rutaIdFinal && nombreRuta) {
        const { data: rutaExistente } = await supabase
          .from('rutas').select('id').ilike('nombre', nombreRuta).maybeSingle();
        if (rutaExistente) {
          rutaIdFinal = rutaExistente.id;
        } else {
          const { data: nuevaRuta } = await supabase
            .from('rutas').insert({ nombre: nombreRuta }).select().single();
          rutaIdFinal = nuevaRuta?.id ?? null;
        }
      }

      if (rutaIdFinal && responsableid) {
        await supabase.from('cobrador_rutas').upsert({
          cobrador_id: responsableid,
          ruta_id: rutaIdFinal,
        }, { onConflict: 'cobrador_id,ruta_id', ignoreDuplicates: true });
      }

      const { data: clienteData, error: clienteError } = await supabase
        .from('clientes')
        .insert({
          nombre: nombreTrimmed,
          telefono: p.clientetelefono ?? p.telefono ?? null,
          direccion: p.clientedireccion ?? p.direccion ?? null,
          cobrador_id: responsableid,
          ruta_id: rutaIdFinal,
        })
        .select().single();

      if (clienteError) throw clienteError;

      const cuotaPorPeriodo = calcularCuota(montoTotalFinal, diasPlazo, frecuencia);
      const cfg = getInfoFrecuencia(frecuencia);
      const numPagos = cfg.pagosPorPlazo(diasPlazo);
      const fechaInicio = new Date();
      const fechaFin = new Date();
      fechaFin.setDate(fechaInicio.getDate() + diasPlazo);
      const fechasPago = generarFechasPago(fechaInicio, frecuencia, diasPlazo);

      const { error: prestamoError } = await supabase.from('prestamos').insert({
        cliente_id: clienteData.id,
        cobrador_id: responsableid,
        monto_prestado: montoPrestado,
        monto_total: montoTotalFinal,
        saldo_pendiente: montoTotalFinal,
        cuota_diaria: cuotaPorPeriodo,
        fecha_inicio: fechaInicio.toISOString(),
        fecha_fin: fechaFin.toISOString(),
        estado: 'activo',
        frecuencia: frecuencia,
        total_pagos_programados: numPagos,
        pagos_realizados: 0,
      });

      if (prestamoError) throw prestamoError;
      creados.push(nombreTrimmed);
    } catch (e) {
      errores.push({ fila, cliente: p.clientenombre ?? '?', error: e.message });
    }
  }

  return res.json({
    message: `${creados.length} préstamos importados, ${errores.length} con error`,
    creados: creados.length,
    errores,
  });
};

const updateLoan = async (req, res) => {
  const supabase = getSupabase();
  const { id } = req.params;
  const { montoprestado, saldopendiente, fechafin } = req.body;

  const montoPrestado = Number(montoprestado);
  const saldoPendiente = Number(saldopendiente);

  if (isNaN(montoPrestado) || montoPrestado <= 0)
    return res.status(400).json({ error: 'montoprestado inválido' });
  if (isNaN(saldoPendiente) || saldoPendiente < 0)
    return res.status(400).json({ error: 'saldopendiente inválido' });
  if (saldoPendiente > montoPrestado * 1.2)
    return res.status(400).json({ error: 'saldopendiente no puede superar el 120% del monto prestado' });
  if (!fechafin)
    return res.status(400).json({ error: 'fechafin es requerida' });

  try {
    const montoTotal = montoPrestado * 1.2;
    const { data: prestamoActual, error: fetchError } = await supabase
      .from('prestamos').select('id, fecha_inicio, frecuencia').eq('id', id).single();
    if (fetchError) throw fetchError;

    const frecuencia = prestamoActual.frecuencia || 'diario';
    const cfg = getInfoFrecuencia(frecuencia);

    const diffMs =
      new Date(fechafin).setHours(0, 0, 0, 0) -
      new Date(prestamoActual.fecha_inicio).setHours(0, 0, 0, 0);
    const diasPlazo = Math.max(cfg.diasPorPeriodo, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    const cuotaDiaria = calcularCuota(montoTotal, diasPlazo, frecuencia);
    const numPagos = cfg.pagosPorPlazo(diasPlazo);
    const nuevoEstado = saldoPendiente === 0 ? 'pagado' : 'activo';

    const { error: updateError } = await supabase
      .from('prestamos')
      .update({
        monto_prestado: montoPrestado,
        monto_total: montoTotal,
        saldo_pendiente: saldoPendiente,
        cuota_diaria: cuotaDiaria,
        fecha_fin: fechafin,
        estado: nuevoEstado,
        total_pagos_programados: numPagos,
      })
      .eq('id', id);

    if (updateError) throw updateError;
    return res.json({ message: 'Préstamo actualizado correctamente' });
  } catch (error) {
    console.error('Error updateLoan:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

const getClavos = async (req, res) => {
  const supabase = getSupabase();
  try {
    const rol = req.user.rol;
    const cobradorid = rol === 'admin' ? null : req.user.id;
    const { data, error } = await supabase.rpc('obtener_clientes_morosos', {
      p_cobrador_id: cobradorid,
    });
    if (error) {
      console.error('Error getClavos RPC:', error.message);
      return res.status(400).json({ error: error.message });
    }
    return res.json(data ?? []);
  } catch (err) {
    console.error('Error getClavos:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

const getLoansByCobrador = async (req, res) => {
  const supabase = getSupabase();
  const cobradorId = req.params.cobradorId;

  try {
    if (req.user?.rol !== "admin") {
      return res.status(403).json({ error: "Solo el administrador puede ver esta información" });
    }

    const { data, error } = await supabase
      .from("prestamos")
      .select(`
        id, cliente_id, cobrador_id,
        monto_prestado, monto_total, saldo_pendiente, cuota_diaria,
        fecha_inicio, fecha_fin, estado, frecuencia,
        total_pagos_programados, pagos_realizados,
        created_at,
        clientes (
          id, nombre, telefono, direccion, ruta_id,
          rutas ( id, nombre )
        ),
        usuarios!prestamos_cobrador_id_fkey (
          id, nombre
        )
      `)
      .eq("cobrador_id", cobradorId)
      .in("estado", ["activo", "mora", "pagado", "renovado"])
      .order("created_at", { ascending: false });

    if (error) throw error;

    const prestamos = (data ?? []).map((p) => ({
      id: p.id,
      cliente_id: p.cliente_id,
      cliente_nombre: p.clientes?.nombre ?? "Sin cliente",
      cliente_telefono: p.clientes?.telefono ?? "",
      cliente_direccion: p.clientes?.direccion ?? "",
      ruta_id: p.clientes?.rutas?.id ?? null,
      ruta_nombre: p.clientes?.rutas?.nombre ?? "Sin ruta",
      cobrador_id: p.cobrador_id,
      cobrador_nombre: p.usuarios?.nombre ?? "Sin cobrador",
      monto_prestado: Number(p.monto_prestado || 0),
      monto_total: Number(p.monto_total || 0),
      saldo_pendiente: Number(p.saldo_pendiente || 0),
      cuota_diaria: Number(p.cuota_diaria || 0),
      fecha_inicio: p.fecha_inicio,
      fecha_fin: p.fecha_fin,
      estado: p.estado,
      frecuencia: p.frecuencia || 'diario',
      total_pagos_programados: p.total_pagos_programados || 0,
      pagos_realizados: p.pagos_realizados || 0,
      created_at: p.created_at,
    }));

    return res.json(prestamos);
  } catch (error) {
    console.error("Error getLoansByCobrador:", error.message);
    return res.status(400).json({ error: error.message });
  }
};

const getCalendarioPagos = async (req, res) => {
  const supabase = getSupabase();
  const prestamoid = req.params.id;

  try {
    const { data: prestamo, error: prestamoError } = await supabase
      .from('prestamos')
      .select('frecuencia, cuota_diaria, total_pagos_programados, fecha_inicio, fecha_fin, monto_total, pagos_realizados')
      .eq('id', prestamoid)
      .single();

    if (prestamoError) throw prestamoError;

    let pagosProgramados = [];
    try {
      const { data } = await supabase
        .from('pagos_programados')
        .select('*')
        .eq('prestamo_id', prestamoid)
        .order('numero_pago');
      pagosProgramados = data ?? [];
    } catch (_) {
      const cfg = getInfoFrecuencia(prestamo.frecuencia || 'diario');
      const totalPagos = prestamo.total_pagos_programados || cfg.pagosPorPlazo(
        Math.ceil((new Date(prestamo.fecha_fin) - new Date(prestamo.fecha_inicio)) / (1000 * 60 * 60 * 24))
      );
      const fechas = generarFechasPago(
        new Date(prestamo.fecha_inicio),
        prestamo.frecuencia || 'diario',
        totalPagos
      );
      pagosProgramados = fechas.map((f, idx) => ({
        numero_pago: idx + 1,
        fecha_programada: f.toISOString().split('T')[0],
        monto_esperado: prestamo.cuota_diaria,
      }));
    }

    return res.json({
      prestamo: {
        id: prestamoid,
        frecuencia: prestamo.frecuencia || 'diario',
        cuota_por_periodo: prestamo.cuota_diaria,
        total_pagos: prestamo.total_pagos_programados,
        pagos_realizados: prestamo.pagos_realizados || 0,
        monto_total: prestamo.monto_total,
      },
      pagos_programados: pagosProgramados,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════
//  🆕 BUSCAR PRÉSTAMOS - Esta es la función que faltaba
// ═══════════════════════════════════════════════════════════════════
const buscarPrestamos = async (req, res) => {
  const supabase = getSupabase();
  const query = req.query.q?.toString().trim() || '';
  const rol = req.user.rol;
  const userId = req.user.id;

  console.log('🔍 buscarPrestamos query:', JSON.stringify(query));

  if (query.length < 2) {
    return res.json([]);
  }

  try {
    // PASO 1: Buscar IDs de clientes que coincidan
    const { data: clientesData, error: clientesError } = await supabase
      .from('clientes')
      .select('id, nombre, telefono, ruta_id')
      .or(`nombre.ilike.%${query}%,telefono.ilike.%${query}%`);

    if (clientesError) {
      console.error('❌ Error buscando clientes:', clientesError);
      throw clientesError;
    }

    const clienteIds = (clientesData ?? []).map(c => c.id);
    const clientesMap = {};
    for (const c of (clientesData ?? [])) {
      clientesMap[c.id] = c;
    }
    console.log(`👥 Clientes encontrados: ${clienteIds.length}`);

    // PASO 2: Buscar IDs de cobradores que coincidan (solo admin)
    let cobradorIds = [];
    let cobradoresMap = {};
    if (rol === 'admin') {
      const { data: cobradoresData } = await supabase
        .from('usuarios')
        .select('id, nombre')
        .eq('rol', 'cobrador')
        .ilike('nombre', `%${query}%`);

      cobradorIds = (cobradoresData ?? []).map(c => c.id);
      for (const c of (cobradoresData ?? [])) {
        cobradoresMap[c.id] = c.nombre;
      }
      console.log(`🏍 Cobradores encontrados: ${cobradorIds.length}`);
    }

    // PASO 3: Construir query de préstamos
    const orFilters = [];
    if (clienteIds.length > 0) {
      orFilters.push(`cliente_id.in.(${clienteIds.join(',')})`);
    }
    if (cobradorIds.length > 0) {
      orFilters.push(`cobrador_id.in.(${cobradorIds.join(',')})`);
    }

    if (orFilters.length === 0) {
      console.log('⚠️ Sin coincidencias en clientes ni cobradores');
      return res.json([]);
    }

    let prestamosQuery = supabase
      .from('prestamos')
      .select('id, monto_prestado, monto_total, saldo_pendiente, cuota_diaria, fecha_inicio, fecha_fin, estado, frecuencia, cobrador_id, cliente_id')
      .or(orFilters.join(','))
      .order('created_at', { ascending: false })
      .limit(20);

    // Si no es admin, solo sus préstamos
    if (rol !== 'admin') {
      prestamosQuery = prestamosQuery.eq('cobrador_id', userId);
    }

    const { data: prestamosData, error: prestamosError } = await prestamosQuery;

    if (prestamosError) {
      console.error('❌ Error buscando préstamos:', prestamosError);
      throw prestamosError;
    }

    console.log(`💼 Préstamos encontrados: ${prestamosData?.length ?? 0}`);

    // PASO 4: Traer las rutas
    const rutaIds = [...new Set((clientesData ?? []).map(c => c.ruta_id).filter(id => id != null))];
    let rutasMap = {};
    if (rutaIds.length > 0) {
      const { data: rutasData } = await supabase
        .from('rutas')
        .select('id, nombre')
        .in('id', rutaIds);
      for (const r of (rutasData ?? [])) {
        rutasMap[r.id] = r.nombre;
      }
    }

    const prestamos = (prestamosData ?? []).map(p => {
      const cliente = clientesMap[p.cliente_id] || {};
      return {
        id: p.id,
        cliente_id: p.cliente_id,
        cliente_nombre: cliente.nombre ?? 'Sin cliente',
        cliente_telefono: cliente.telefono ?? '',
        ruta_nombre: cliente.ruta_id ? (rutasMap[cliente.ruta_id] ?? 'Sin ruta') : 'Sin ruta',
        cobrador_nombre: cobradoresMap[p.cobrador_id] ?? 'Cobrador',
        monto_total: Number(p.monto_total) || 0,
        saldo_pendiente: Number(p.saldo_pendiente) || 0,
        cuota_diaria: Number(p.cuota_diaria) || 0,
        estado: p.estado ?? 'activo',
        frecuencia: p.frecuencia ?? 'diario',
      };
    });

    return res.json(prestamos);
  } catch (error) {
    console.error('❌ Error buscarPrestamos:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════
//  EXPORTAR
// ═══════════════════════════════════════════════════════════════════
module.exports = {
  createLoan,
  updateLoan,
  getClavos,
  importarPrestamos,
  getLoansByCobrador,
  getCalendarioPagos,
  buscarPrestamos,  // 🆕 ESTA LÍNEA ES LA QUE FALTABA
};
