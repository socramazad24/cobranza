const getSupabase = require('../config/supabaseClient');

const toDateString = (date) => {
  if (!date) return new Date().toISOString().split('T')[0];
  if (typeof date === 'string' && date.length === 10) return date.slice(0, 10);
  return new Date(date).toISOString().split('T')[0];
};

const abrirCaja = async (req, res) => {
  const supabase = getSupabase();
  const rawCobradorId = req.body.cobrador_id ?? req.body.cobradorid;
  const cobradorid = (!rawCobradorId || rawCobradorId === null || rawCobradorId === undefined)
    ? req.user?.id
    : rawCobradorId;
  const baseRecibida = req.body.base_entregada ?? req.body.baseentregada ?? 0;
  const fechaStr = toDateString(req.body.fecha);

  if (!cobradorid) return res.status(400).json({ error: 'cobrador_id es requerido' });

  const base = Number(baseRecibida);
  if (isNaN(base) || base < 0)
    return res.status(400).json({ error: 'base_entregada debe ser un número válido' });

  try {
    const { data: existente, error: findError } = await supabase
      .from('caja_diaria')
      .select('id, total_cobrado, total_entregado, base_entregada')
      .eq('cobrador_id', cobradorid)
      .eq('fecha', fechaStr)
      .maybeSingle();

    if (findError) throw findError;

    if (existente) {
      const totalCobrado = Number(existente.total_cobrado) || 0;
      const totalEntregado = existente.total_entregado === null
        ? null
        : Number(existente.total_entregado);
      const diferencia = totalEntregado === null
        ? 0
        : (base + totalCobrado - totalEntregado);

      const { error: updateError } = await supabase
        .from('caja_diaria')
        .update({ base_entregada: base, diferencia })
        .eq('id', existente.id);

      if (updateError) throw updateError;
      return res.status(200).json({ message: 'Caja actualizada correctamente', yaexistia: true });
    }

    const { error: insertError } = await supabase.from('caja_diaria').insert({
      cobrador_id: cobradorid,
      fecha: fechaStr,
      base_entregada: base,
      total_cobrado: 0,
      total_entregado: 0,
      diferencia: base,
    });

    if (insertError) throw insertError;
    return res.status(201).json({ message: 'Caja del día creada correctamente', yaexistia: false });
  } catch (error) {
    console.error('Error abrirCaja:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

const cerrarCaja = async (req, res) => {
  const supabase = getSupabase();
  const { id } = req.params;
  const totalentregado = req.body.total_entregado ?? req.body.totalentregado;
  const entregado = Number(totalentregado);

  if (isNaN(entregado) || entregado < 0)
    return res.status(400).json({ error: 'total_entregado debe ser un número válido' });

  try {
    const { data: caja, error: cajaError } = await supabase
      .from('caja_diaria')
      .select('id, total_cobrado, base_entregada')
      .eq('id', id)
      .single();

    if (cajaError) throw cajaError;

    const diferencia =
      (Number(caja.total_cobrado) || 0) +
      (Number(caja.base_entregada) || 0) -
      entregado;

    const { error: updateError } = await supabase
      .from('caja_diaria')
      .update({
        total_entregado: entregado,
        diferencia,
        cerrado_por: req.user?.id ?? null,
      })
      .eq('id', id);

    if (updateError) throw updateError;
    return res.json({ message: 'Caja cerrada correctamente' });
  } catch (error) {
    console.error('Error cerrarCaja:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

const reabrirCaja = async (req, res) => {
  const supabase = getSupabase();
  const { id } = req.params;

  if (req.user?.rol !== 'admin')
    return res.status(403).json({ error: 'Solo el administrador puede reabrir la caja' });

  try {
    const { error } = await supabase
      .from('caja_diaria')
      .update({ total_entregado: null, diferencia: null, cerrado_por: null })
      .eq('id', id);

    if (error) throw error;
    return res.json({ message: 'Caja reabierta correctamente' });
  } catch (error) {
    console.error('Error reabrirCaja:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

// SOLO edita total_entregado — sin recalcular diferencia, sin dejar pendiente
const editarMontoRecibido = async (req, res) => {
  const supabase = getSupabase();
  const { id } = req.params;

  if (!['admin', 'cajero'].includes(req.user?.rol))
    return res.status(403).json({ error: 'Sin permiso para esta acción' });

  const totalentregado = req.body.total_entregado ?? req.body.totalentregado;
  const entregado = Number(totalentregado);

  if (isNaN(entregado) || entregado < 0)
    return res.status(400).json({ error: 'total_entregado debe ser un número válido' });

  try {
    // SOLO actualiza total_entregado. No toca diferencia ni ningún otro campo.
    const { error: updateError } = await supabase
      .from('caja_diaria')
      .update({ total_entregado: entregado })
      .eq('id', id);

    if (updateError) throw updateError;
    return res.json({ message: 'Monto recibido actualizado correctamente' });
  } catch (error) {
    console.error('Error editarMontoRecibido:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

const getResumenCajaAdmin = async (req, res) => {
  const supabase = getSupabase();
  const fecha = toDateString(req.query.fecha);

  try {
    const { data: cajas, error: cajasError } = await supabase
      .from('caja_diaria')
      .select(`
        id, cobrador_id, fecha, base_entregada, total_cobrado, total_entregado, diferencia,
        usuarios!caja_diaria_cobrador_id_fkey(id, nombre)
      `)
      .eq('fecha', fecha)
      .order('fecha', { ascending: false });

    if (cajasError) throw cajasError;

    const cajasConPagos = await Promise.all(
      (cajas ?? []).map(async (caja) => {
        const { data: pagos } = await supabase
          .from('pagos')
          .select('id, prestamo_id, monto_pagado, fecha_pago, cobrador_id')
          .eq('cobrador_id', caja.cobrador_id)
          .gte('fecha_pago', `${fecha}T00:00:00`)
          .lte('fecha_pago', `${fecha}T23:59:59`);

        const base = Number(caja.base_entregada) || 0;
        const cobrado = Number(caja.total_cobrado) || 0;
        const entregado = caja.total_entregado === null ? null : Number(caja.total_entregado);
        const diferencia = caja.diferencia === null
          ? (base + cobrado - Number(caja.total_entregado || 0))
          : Number(caja.diferencia);

        return {
          id: caja.id,
          cobrador_id: caja.cobrador_id,
          cobradornombre: caja.usuarios?.nombre ?? '',
          fecha: caja.fecha,
          base_entregada: base,
          total_cobrado: cobrado,
          total_entregado: entregado,
          diferencia,
          cerrada: entregado !== null,
          pagosdeldia: (pagos ?? []).map((p) => ({
            id: p.id,
            prestamo_id: p.prestamo_id,
            monto_pagado: Number(p.monto_pagado) || 0,
            fecha_pago: p.fecha_pago,
            cobrador_id: p.cobrador_id,
          })),
        };
      })
    );

    const totalBaseEntregada = cajasConPagos.reduce((s, c) => s + c.base_entregada, 0);
    const totalCobrado = cajasConPagos.reduce((s, c) => s + c.total_cobrado, 0);
    const totalEntregado = cajasConPagos.reduce((s, c) => s + (c.total_entregado || 0), 0);
    const saldoCaja = totalBaseEntregada + totalCobrado - totalEntregado;

    return res.json({
      resumen: {
        fecha,
        total_base_entregada: totalBaseEntregada,
        total_cobrado: totalCobrado,
        total_entregado: totalEntregado,
        saldo_caja: saldoCaja,
        total_cobradores: cajasConPagos.length,
      },
      cajas: cajasConPagos,
    });
  } catch (error) {
    console.error('Error getResumenCajaAdmin:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

const getHistorialCobrador = async (req, res) => {
  const supabase = getSupabase();
  const cobradorid = req.params.cobradorid ?? req.params.id;

  try {
    const { data, error } = await supabase
      .from('caja_diaria')
      .select(`
        id, cobrador_id, fecha, base_entregada, total_cobrado, total_entregado, diferencia,
        usuarios!caja_diaria_cobrador_id_fkey(id, nombre)
      `)
      .eq('cobrador_id', cobradorid)
      .order('fecha', { ascending: false });

    if (error) throw error;

    const historial = (data ?? []).map((caja) => ({
      id: caja.id,
      cobrador_id: caja.cobrador_id,
      cobradornombre: caja.usuarios?.nombre ?? '',
      fecha: caja.fecha,
      base_entregada: Number(caja.base_entregada) || 0,
      total_cobrado: Number(caja.total_cobrado) || 0,
      total_entregado: caja.total_entregado === null ? null : Number(caja.total_entregado),
      diferencia: caja.diferencia === null ? null : Number(caja.diferencia),
    }));

    return res.json(historial);
  } catch (error) {
    console.error('Error getHistorialCobrador:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

const getMiCajaHoy = async (req, res) => {
  const supabase = getSupabase();
  const cobradorid = req.user.id;
  const fecha = toDateString();

  try {
    const { data: caja, error: cajaError } = await supabase
      .from('caja_diaria')
      .select('id, cobrador_id, fecha, base_entregada, total_cobrado, total_entregado, diferencia')
      .eq('cobrador_id', cobradorid)
      .eq('fecha', fecha)
      .maybeSingle();

    if (cajaError) throw cajaError;

    const { data: pagos, error: pagosError } = await supabase
      .from('pagos')
      .select('id, prestamo_id, monto_pagado, fecha_pago, cobrador_id')
      .eq('cobrador_id', cobradorid)
      .gte('fecha_pago', `${fecha}T00:00:00`)
      .lte('fecha_pago', `${fecha}T23:59:59`)
      .order('fecha_pago', { ascending: false });

    if (pagosError) throw pagosError;

    if (!caja) {
      return res.json({
        tienecaja: false,
        fecha,
        base_entregada: 0,
        total_cobrado: 0,
        total_entregado: 0,
        diferencia: 0,
        pagosdeldia: [],
      });
    }

    return res.json({
      tienecaja: true,
      id: caja.id,
      cobrador_id: caja.cobrador_id,
      fecha: caja.fecha,
      base_entregada: Number(caja.base_entregada) || 0,
      total_cobrado: Number(caja.total_cobrado) || 0,
      total_entregado: caja.total_entregado === null ? 0 : Number(caja.total_entregado),
      diferencia: caja.diferencia === null ? 0 : Number(caja.diferencia),
      pagosdeldia: (pagos ?? []).map((p) => ({
        id: p.id,
        prestamo_id: p.prestamo_id,
        monto_pagado: Number(p.monto_pagado) || 0,
        fecha_pago: p.fecha_pago,
        cobrador_id: p.cobrador_id,
      })),
    });
  } catch (error) {
    console.error('Error getMiCajaHoy:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

module.exports = {
  abrirCaja,
  cerrarCaja,
  reabrirCaja,
  editarMontoRecibido,
  getResumenCajaAdmin,
  getHistorialCobrador,
  getMiCajaHoy,
};