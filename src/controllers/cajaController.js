const getSupabase = require('../config/supabaseClient');

const toDateString = (date) => {
  if (!date) return new Date().toISOString().split('T')[0];
  if (typeof date === 'string' && date.length >= 10) return date.slice(0, 10);
  return new Date(date).toISOString().split('T')[0];
};

const abrirCaja = async (req, res) => {
  const supabase = getSupabase();

  const rawCobradorId = req.body.cobrador_id ?? req.body.cobradorid;
  const cobrador_id =
    !rawCobradorId || rawCobradorId === 'null' || rawCobradorId === 'undefined'
      ? req.user?.id
      : rawCobradorId;

  const baseRecibida =
    req.body.base_entregada ??
    req.body.baseentregada ??
    0;

  const { fecha } = req.body;
  const fechaStr = toDateString(fecha);

  if (!cobrador_id) {
    return res.status(400).json({ error: 'cobrador_id es requerido' });
  }

  const base = Number(baseRecibida);
  if (Number.isNaN(base) || base < 0) {
    return res.status(400).json({ error: 'base_entregada debe ser un número válido' });
  }

  try {
    const { data: existente, error: findError } = await supabase
      .from('caja_diaria')
      .select('id, total_cobrado, total_entregado, base_entregada')
      .eq('cobrador_id', cobrador_id)
      .eq('fecha', fechaStr)
      .maybeSingle();

    if (findError) throw findError;

    if (existente) {
      const totalCobrado = Number(existente.total_cobrado || 0);
      const totalEntregado =
        existente.total_entregado == null ? null : Number(existente.total_entregado);

      const nuevaBase = base;
      const diferencia =
        totalEntregado == null ? 0 : nuevaBase + totalCobrado - totalEntregado;

      const { error: updateError } = await supabase
        .from('caja_diaria')
        .update({
          base_entregada: nuevaBase,
          diferencia,
        })
        .eq('id', existente.id);

      if (updateError) throw updateError;

      return res.status(200).json({
        message: 'Caja del día actualizada correctamente',
        ya_existia: true,
      });
    }

    const { error: insertError } = await supabase
      .from('caja_diaria')
      .insert([
        {
          cobrador_id,
          fecha: fechaStr,
          base_entregada: base,
          total_cobrado: 0,
          total_entregado: 0,
          diferencia: base,
        },
      ]);

    if (insertError) throw insertError;

    return res.status(201).json({
      message: 'Caja del día creada correctamente',
      ya_existia: false,
    });
  } catch (error) {
    console.error('Error abrirCaja:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

const cerrarCaja = async (req, res) => {
  const supabase = getSupabase();
  const { id } = req.params;
  const { total_entregado } = req.body;

  const entregado = Number(total_entregado);
  if (Number.isNaN(entregado) || entregado < 0) {
    return res.status(400).json({ error: 'total_entregado debe ser un número válido' });
  }

  try {
    const { data: caja, error: cajaError } = await supabase
      .from('caja_diaria')
      .select('id, total_cobrado, base_entregada')
      .eq('id', id)
      .single();

    if (cajaError) throw cajaError;

    const diferencia =
      Number(caja.total_cobrado || 0) +
      Number(caja.base_entregada || 0) -
      entregado;

    const { error: updateError } = await supabase
      .from('caja_diaria')
      .update({
        total_entregado: entregado,
        diferencia,
      })
      .eq('id', id);

    if (updateError) throw updateError;

    return res.json({ message: 'Caja cerrada correctamente' });
  } catch (error) {
    console.error('Error cerrarCaja:', error.message);
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
        id,
        cobrador_id,
        fecha,
        base_entregada,
        total_cobrado,
        total_entregado,
        diferencia,
        usuarios:cobrador_id (
          id,
          nombre
        )
      `)
      .eq('fecha', fecha)
      .order('fecha', { ascending: false });

    if (cajasError) throw cajasError;

    const cajasConPagos = await Promise.all(
      (cajas ?? []).map(async (caja) => {
        const { data: pagos, error: pagosError } = await supabase
          .from('pagos')
          .select('id, prestamo_id, monto_pagado, fecha_pago, cobrador_id')
          .eq('cobrador_id', caja.cobrador_id)
          .gte('fecha_pago', `${fecha}T00:00:00`)
          .lt('fecha_pago', `${fecha}T23:59:59`);

        if (pagosError) throw pagosError;

        const base = Number(caja.base_entregada || 0);
        const cobrado = Number(caja.total_cobrado || 0);
        const entregado =
          caja.total_entregado == null ? null : Number(caja.total_entregado);

        const diferencia =
          caja.diferencia == null
            ? base + cobrado - Number(caja.total_entregado || 0)
            : Number(caja.diferencia);

        return {
          id: caja.id,
          usuariosid: caja.cobrador_id,
          cobradornombre: caja.usuarios?.nombre ?? '',
          fecha: caja.fecha,
          baseentregada: base,
          totalcobrado: cobrado,
          totalentregado: entregado,
          diferencia,
          pagosdeldia: (pagos ?? []).map((p) => ({
            id: p.id,
            prestamo_id: p.prestamo_id,
            monto_pagado: Number(p.monto_pagado || 0),
            fecha_pago: p.fecha_pago,
            cobrador_id: p.cobrador_id,
          })),
        };
      })
    );

    const totalBaseEntregada = cajasConPagos.reduce(
      (sum, c) => sum + Number(c.baseentregada || 0),
      0
    );
    const totalCobrado = cajasConPagos.reduce(
      (sum, c) => sum + Number(c.totalcobrado || 0),
      0
    );
    const totalEntregado = cajasConPagos.reduce(
      (sum, c) => sum + Number(c.totalentregado || 0),
      0
    );
    const saldoCaja = totalBaseEntregada + totalCobrado - totalEntregado;

    return res.json({
      resumen: {
        fecha,
        totalbaseentregada: totalBaseEntregada,
        totalcobrado: totalCobrado,
        totalentregado: totalEntregado,
        saldocaja: saldoCaja,
        totalcobradores: cajasConPagos.length,
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
  const { cobrador_id } = req.params;

  try {
    const { data, error } = await supabase
      .from('caja_diaria')
      .select(`
        id,
        cobrador_id,
        fecha,
        base_entregada,
        total_cobrado,
        total_entregado,
        diferencia,
        usuarios:cobrador_id (
          id,
          nombre
        )
      `)
      .eq('cobrador_id', cobrador_id)
      .order('fecha', { ascending: false });

    if (error) throw error;

    const historial = (data ?? []).map((caja) => ({
      id: caja.id,
      usuariosid: caja.cobrador_id,
      cobradornombre: caja.usuarios?.nombre ?? '',
      fecha: caja.fecha,
      baseentregada: Number(caja.base_entregada || 0),
      totalcobrado: Number(caja.total_cobrado || 0),
      totalentregado:
        caja.total_entregado == null ? null : Number(caja.total_entregado),
      diferencia:
        caja.diferencia == null ? null : Number(caja.diferencia),
    }));

    return res.json(historial);
  } catch (error) {
    console.error('Error getHistorialCobrador:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

const getMiCajaHoy = async (req, res) => {
  const supabase = getSupabase();
  const cobrador_id = req.user.id;
  const fecha = toDateString();

  try {
    const { data: caja, error: cajaError } = await supabase
      .from('caja_diaria')
      .select(`
        id,
        cobrador_id,
        fecha,
        base_entregada,
        total_cobrado,
        total_entregado,
        diferencia
      `)
      .eq('cobrador_id', cobrador_id)
      .eq('fecha', fecha)
      .maybeSingle();

    if (cajaError) throw cajaError;

    const { data: pagos, error: pagosError } = await supabase
      .from('pagos')
      .select('id, prestamo_id, monto_pagado, fecha_pago, cobrador_id')
      .eq('cobrador_id', cobrador_id)
      .gte('fecha_pago', `${fecha}T00:00:00`)
      .lt('fecha_pago', `${fecha}T23:59:59`)
      .order('fecha_pago', { ascending: false });

    if (pagosError) throw pagosError;

    if (!caja) {
      return res.json({
        tienecaja: false,
        fecha,
        baseentregada: 0,
        totalcobrado: 0,
        totalentregado: 0,
        diferencia: 0,
        pagosdeldia: [],
      });
    }

    return res.json({
      tienecaja: true,
      id: caja.id,
      fecha: caja.fecha,
      baseentregada: Number(caja.base_entregada || 0),
      totalcobrado: Number(caja.total_cobrado || 0),
      totalentregado:
        caja.total_entregado == null ? 0 : Number(caja.total_entregado),
      diferencia:
        caja.diferencia == null ? 0 : Number(caja.diferencia),
      pagosdeldia: (pagos ?? []).map((p) => ({
        id: p.id,
        prestamo_id: p.prestamo_id,
        monto_pagado: Number(p.monto_pagado || 0),
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
  getResumenCajaAdmin,
  getHistorialCobrador,
  getMiCajaHoy,
};