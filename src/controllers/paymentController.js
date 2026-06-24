const getSupabase = require('../config/supabaseClient');

const registerPayment = async (req, res) => {
  const supabase = getSupabase();
  const prestamoid = req.body.prestamo_id ?? req.body.prestamoid;
  const montopagado = req.body.monto_pagado ?? req.body.montopagado;
  const cobradorid = req.user.id;

  if (!prestamoid) return res.status(400).json({ error: 'prestamo_id es requerido' });
  const montoIngresado = Number(montopagado);
  if (Number.isNaN(montoIngresado) || montoIngresado <= 0)
    return res.status(400).json({ error: 'monto_pagado debe ser mayor a 0' });

  try {
    const { data: prestamo, error: fetchError } = await supabase
      .from('prestamos')
      .select('id, saldo_pendiente, estado, cobrador_id')
      .eq('id', prestamoid)
      .single();

    if (fetchError) throw fetchError;

    if (prestamo.estado !== 'activo')
      return res.status(400).json({ error: 'Este préstamo ya fue pagado o renovado' });

    if (String(prestamo.cobrador_id) !== String(cobradorid) && req.user.rol !== 'admin')
      return res.status(403).json({ error: 'No puedes registrar pagos de un préstamo que no te pertenece' });

    const saldoActual = Number(prestamo.saldo_pendiente) || 0;
    if (montoIngresado > saldoActual)
      return res.status(400).json({
        error: `El monto ${montoIngresado.toFixed(0)} supera el saldo pendiente de ${saldoActual.toFixed(0)}`,
        saldo_pendiente: saldoActual,
      });

    const { data: pago, error: pagoError } = await supabase
      .from('pagos')
      .insert({ prestamo_id: prestamoid, cobrador_id: cobradorid, monto_pagado: montoIngresado })
      .select()
      .single();

    if (pagoError) throw pagoError;

    const nuevoSaldo = saldoActual - montoIngresado;
    const saldoFinal = nuevoSaldo < 0 ? 0 : nuevoSaldo;
    const nuevoEstado = saldoFinal === 0 ? 'pagado' : 'activo';

    const { error: updatePrestamoError } = await supabase
      .from('prestamos')
      .update({ saldo_pendiente: saldoFinal, estado: nuevoEstado })
      .eq('id', prestamoid);

    if (updatePrestamoError) throw updatePrestamoError;

    // ── Actualizar caja_diaria ───────────────────────────────────────────────
    const fecha = new Date().toISOString().split('T')[0];

    const { data: cajaExistente, error: cajaError } = await supabase
      .from('caja_diaria')
      .select('id, base_entregada, total_cobrado, total_entregado, diferencia')
      .eq('cobrador_id', cobradorid)
      .eq('fecha', fecha)
      .maybeSingle();

    if (cajaError) throw cajaError;

    if (cajaExistente) {
      const baseEntregada = Number(cajaExistente.base_entregada) || 0;
      const nuevoTotalCobrado = (Number(cajaExistente.total_cobrado) || 0) + montoIngresado;
      const totalEntregado =
        cajaExistente.total_entregado === null ? null : Number(cajaExistente.total_entregado);
      // Si la caja ya está cerrada, diferencia se actualiza (pendiente extra)
      const nuevaDiferencia =
        totalEntregado === null ? 0 : baseEntregada + nuevoTotalCobrado - totalEntregado;

      const { error: updateCajaError } = await supabase
        .from('caja_diaria')
        .update({ total_cobrado: nuevoTotalCobrado, diferencia: nuevaDiferencia })
        .eq('id', cajaExistente.id);

      if (updateCajaError) throw updateCajaError;
    } else {
      const { error: insertCajaError } = await supabase.from('caja_diaria').insert({
        cobrador_id: cobradorid,
        fecha,
        base_entregada: 0,
        total_cobrado: montoIngresado,
        total_entregado: 0,
        diferencia: montoIngresado,
      });
      if (insertCajaError) throw insertCajaError;
    }

    return res.status(201).json({
      message: 'Pago registrado',
      pago,
      saldorestante: saldoFinal,
      estado: nuevoEstado,
      fechapago: pago?.fecha_pago ?? new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error en pago:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

const getPaymentHistory = async (req, res) => {
  const supabase = getSupabase();
  const prestamoid = req.params.prestamo_id ?? req.params.prestamoid;

  const { data, error } = await supabase
    .from('pagos')
    .select('*')
    .eq('prestamo_id', prestamoid)
    .order('fecha_pago', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });

  const historial = (data ?? []).map((p) => ({
    ...p,
    prestamoid: p.prestamo_id,
    montopagado: p.monto_pagado,
    fechapago: p.fecha_pago,
    cobradorid: p.cobrador_id,
  }));

  return res.json(historial);
};

const getActiveLoans = async (req, res) => {
  const supabase = getSupabase();
  const cobradorid = req.user.id;
  const rol = req.user.rol;

  let query = supabase
    .from('prestamos')
    .select(`
      id, monto_prestado, monto_total, saldo_pendiente, cuota_diaria,
      fecha_inicio, fecha_fin, estado, cobrador_id,
      usuarios!prestamos_cobrador_id_fkey(nombre),
      clientes(id, nombre, telefono, rutas(id, nombre))
    `)
    .eq('estado', 'activo')
    .order('fecha_inicio', { ascending: false });

  if (rol !== 'admin') query = query.eq('cobrador_id', cobradorid);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });

  const prestamos = (data ?? []).map((p) => ({
    ...p,
    cobradornombre: p.usuarios?.nombre ?? null,
    clientenombre: p.clientes?.nombre ?? null,
    clientetelefono: p.clientes?.telefono ?? null,
    rutanombre: p.clientes?.rutas?.nombre ?? null,
  }));

  return res.json(prestamos);
};

const renewLoan = async (req, res) => {
  const supabase = getSupabase();
  const prestamoid = req.body.prestamo_id ?? req.body.prestamoid;
  const diasplazo = req.body.dias_plazo ?? req.body.diasplazo;

  if (!prestamoid) return res.status(400).json({ error: 'prestamo_id es requerido' });
  if (!diasplazo || Number(diasplazo) <= 0)
    return res.status(400).json({ error: 'diasplazo debe ser mayor a 0' });

  try {
    const { data: prestamo, error: fetchError } = await supabase
      .from('prestamos')
      .select('id, saldo_pendiente, cobrador_id, clientes(id)')
      .eq('id', prestamoid)
      .single();

    if (fetchError) throw fetchError;

    const { error: updateOldLoanError } = await supabase
      .from('prestamos').update({ estado: 'renovado' }).eq('id', prestamoid);

    if (updateOldLoanError) throw updateOldLoanError;

    const nuevoMonto = Number(prestamo.saldo_pendiente) || 0;
    const nuevoTotal = nuevoMonto * 1.2;
    const nuevaCuota = nuevoTotal / Number(diasplazo);
    const fechaInicio = new Date();
    const fechaFin = new Date();
    fechaFin.setDate(fechaInicio.getDate() + Number(diasplazo));

    const { data: nuevoPrestamo, error: newLoanError } = await supabase
      .from('prestamos')
      .insert({
        cliente_id: prestamo.clientes.id,
        cobrador_id: prestamo.cobrador_id,
        monto_prestado: nuevoMonto,
        monto_total: nuevoTotal,
        saldo_pendiente: nuevoTotal,
        cuota_diaria: nuevaCuota,
        fecha_inicio: fechaInicio.toISOString(),
        fecha_fin: fechaFin.toISOString(),
        estado: 'activo',
      })
      .select().single();

    if (newLoanError) throw newLoanError;

    return res.status(201).json({
      message: 'Préstamo renovado exitosamente',
      prestamo: nuevoPrestamo,
      prestamoid: nuevoPrestamo.id,
    });
  } catch (error) {
    console.error('Error al renovar:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

module.exports = { registerPayment, getPaymentHistory, getActiveLoans, renewLoan };