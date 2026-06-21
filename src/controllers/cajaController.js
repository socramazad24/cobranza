const getSupabase = require('../config/supabaseClient');

// ─── ADMIN: Abrir / asignar base del día a un cobrador ───────────────────────
const abrirCaja = async (req, res) => {
  const supabase = getSupabase();
  if (req.user.rol !== 'admin')
    return res.status(403).json({ error: 'Solo el admin puede asignar la base del día' });

  const { cobrador_id, base_entregada, fecha, observacion } = req.body;
  const hoy = fecha || new Date().toISOString().split('T')[0];

  // Upsert: si ya existe la caja del día la actualiza, si no la crea
  const { data, error } = await supabase
    .from('caja_diaria')
    .upsert(
      { cobrador_id, fecha: hoy, base_entregada, observacion, total_cobrado: 0 },
      { onConflict: 'cobrador_id,fecha', ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: 'Base del día registrada', caja: data });
};

// ─── ADMIN: Cerrar el día — registrar lo que entregó el cobrador ──────────────
const cerrarCaja = async (req, res) => {
  const supabase = getSupabase();
  if (req.user.rol !== 'admin')
    return res.status(403).json({ error: 'Solo el admin puede cerrar la caja' });

  const { id } = req.params; // id de la caja_diaria
  const { total_entregado, observacion } = req.body;

  const { data, error } = await supabase
    .from('caja_diaria')
    .update({ total_entregado, observacion, cerrado_por: req.user.id })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Caja cerrada correctamente', caja: data });
};

// ─── ADMIN: Ver resumen general de caja (todas las cajas de un día) ───────────
const getResumenCajaAdmin = async (req, res) => {
  const supabase = getSupabase();
  if (req.user.rol !== 'admin')
    return res.status(403).json({ error: 'Acceso denegado' });

  const fecha = req.query.fecha || new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('caja_diaria')
    .select(`
      id, fecha, base_entregada, total_cobrado, total_entregado, observacion,
      usuarios!caja_diaria_cobrador_id_fkey (id, nombre)
    `)
    .eq('fecha', fecha)
    .order('fecha', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });

  // Calcular totales para la caja del admin
  const totalBaseEntregada = data.reduce((s, c) => s + parseFloat(c.base_entregada || 0), 0);
  const totalCobrado       = data.reduce((s, c) => s + parseFloat(c.total_cobrado || 0), 0);
  const totalEntregado     = data.reduce((s, c) => s + parseFloat(c.total_entregado || 0), 0);
  const cajasAbiertas      = data.filter(c => c.total_entregado === null).length;

  // Saldo en caja del admin:
  // Lo que entregaron los cobradores - Lo que les dio de base
  const saldoCaja = totalEntregado - totalBaseEntregada;

  res.json({
    fecha,
    cajas: data.map(c => ({
      ...c,
      cobrador_nombre: c.usuarios?.nombre,
      diferencia: c.total_entregado !== null
        ? parseFloat(c.total_entregado) - parseFloat(c.total_cobrado)
        : null, // diferencia entre lo que entregó y lo que realmente cobró
    })),
    resumen: {
      total_base_entregada: totalBaseEntregada,
      total_cobrado:        totalCobrado,
      total_entregado:      totalEntregado,
      saldo_caja:           saldoCaja,
      cajas_abiertas:       cajasAbiertas,
    }
  });
};

// ─── ADMIN/COBRADOR: Historial de caja de un cobrador específico ──────────────
const getHistorialCobrador = async (req, res) => {
  const supabase = getSupabase();
  const { cobrador_id } = req.params;

  // Un cobrador solo puede ver su propio historial
  if (req.user.rol !== 'admin' && req.user.id !== cobrador_id)
    return res.status(403).json({ error: 'Acceso denegado' });

  const { desde, hasta } = req.query;
  let query = supabase
    .from('caja_diaria')
    .select('*')
    .eq('cobrador_id', cobrador_id)
    .order('fecha', { ascending: false });

  if (desde) query = query.gte('fecha', desde);
  if (hasta) query = query.lte('fecha', hasta);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });

  // Enriquecer con pagos de ese día
  const enriched = await Promise.all(data.map(async (caja) => {
    const { data: pagos } = await supabase
      .from('pagos')
      .select('monto_pagado, fecha_pago, prestamos(clientes(nombre))')
      .eq('cobrador_id', cobrador_id)
      .gte('fecha_pago', `${caja.fecha}T00:00:00`)
      .lte('fecha_pago', `${caja.fecha}T23:59:59`);

    return {
      ...caja,
      pagos_del_dia: pagos || [],
    };
  }));

  res.json(enriched);
};

// ─── COBRADOR: Ver su caja del día actual ─────────────────────────────────────
const getMiCajaHoy = async (req, res) => {
  const supabase = getSupabase();
  const hoy = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('caja_diaria')
    .select('*')
    .eq('cobrador_id', req.user.id)
    .eq('fecha', hoy)
    .single();

  if (error && error.code !== 'PGRST116') // PGRST116 = no rows found
    return res.status(400).json({ error: error.message });

  // Si no tiene caja hoy, devolver estado vacío
  if (!data) return res.json({
    tiene_caja: false,
    base_entregada: 0,
    total_cobrado: 0,
    mensaje: 'El admin aún no ha asignado tu base del día'
  });

  // Traer pagos del día para desglose
  const { data: pagos } = await supabase
    .from('pagos')
    .select('monto_pagado, fecha_pago, prestamos(clientes(nombre))')
    .eq('cobrador_id', req.user.id)
    .gte('fecha_pago', `${hoy}T00:00:00`)
    .lte('fecha_pago', `${hoy}T23:59:59`)
    .order('fecha_pago', { ascending: false });

  res.json({
    tiene_caja: true,
    ...data,
    pagos_del_dia: pagos || [],
  });
};

module.exports = { abrirCaja, cerrarCaja, getResumenCajaAdmin, getHistorialCobrador, getMiCajaHoy };