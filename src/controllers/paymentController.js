// src/controllers/paymentController.js
const supabase = require('../config/supabaseClient');

// ── REGISTRAR ABONO ───────────────────────────────────────────
const registerPayment = async (req, res) => {
  const { prestamo_id, monto_pagado } = req.body;
  const cobrador_id = req.user.id;

  try {
    const { data: prestamo, error: fetchError } = await supabase
      .from('prestamos')
      .select('saldo_pendiente, estado')
      .eq('id', prestamo_id)
      .single();

    if (fetchError) throw fetchError;

    if (prestamo.estado !== 'activo') {
      return res.status(400).json({
        error: 'Este préstamo ya fue pagado o renovado',
      });
    }

    const saldoActual    = parseFloat(prestamo.saldo_pendiente);
    const montoIngresado = parseFloat(monto_pagado);

    if (montoIngresado <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
    }

    if (montoIngresado > saldoActual) {
      return res.status(400).json({
        error: `El monto $${montoIngresado.toFixed(0)} supera el saldo pendiente de $${saldoActual.toFixed(0)}`,
        saldo_pendiente: saldoActual,
      });
    }

    const { error: pagoError } = await supabase.from('pagos').insert([{
      prestamo_id,
      cobrador_id,
      monto_pagado: montoIngresado,
    }]);
    if (pagoError) throw pagoError;

    const nuevoSaldo = saldoActual - montoIngresado;

    const { error: updateError } = await supabase
      .from('prestamos')
      .update({
        saldo_pendiente: nuevoSaldo <= 0 ? 0 : nuevoSaldo,
        estado:          nuevoSaldo <= 0 ? 'pagado' : 'activo',
      })
      .eq('id', prestamo_id);
    if (updateError) throw updateError;

    res.status(201).json({
      message:        'Pago registrado',
      saldo_restante: nuevoSaldo <= 0 ? 0 : nuevoSaldo,
      estado:         nuevoSaldo <= 0 ? 'pagado' : 'activo',
    });

  } catch (error) {
    console.error('❌ Error en pago:', error.message);
    res.status(400).json({ error: error.message });
  }
};

// ── HISTORIAL DE PAGOS ────────────────────────────────────────
const getPaymentHistory = async (req, res) => {
  const { prestamo_id } = req.params;

  const { data, error } = await supabase
    .from('pagos')
    .select('*')
    .eq('prestamo_id', prestamo_id)
    .order('fecha_pago', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// ── PRÉSTAMOS ACTIVOS ─────────────────────────────────────────
const getActiveLoans = async (req, res) => {
  const cobrador_id = req.user.id;
  const rol         = req.user.rol;

  // ✅ Admin ve todos — cobrador solo ve los suyos
  let query = supabase
    .from('prestamos')
    .select(`
      id,
      monto_prestado,
      monto_total,
      saldo_pendiente,
      cuota_diaria,
      fecha_inicio,
      fecha_fin,
      estado,
      cobrador_id,
      usuarios!prestamos_cobrador_id_fkey ( nombre ),
      clientes (
        id, nombre, telefono,
        rutas ( id, nombre )
      )
    `)
    .eq('estado', 'activo')
    .order('fecha_inicio', { ascending: false });

  // ✅ Filtro por cobrador si no es admin
  if (rol !== 'admin') {
    query = query.eq('cobrador_id', cobrador_id);
  }

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// ── RENOVAR PRÉSTAMO ──────────────────────────────────────────
const renewLoan = async (req, res) => {
  const { prestamo_id, dias_plazo } = req.body;
  const cobrador_id = req.user.id;

  try {
    const { data: prestamo, error: fetchError } = await supabase
      .from('prestamos')
      .select('*, clientes(id)')
      .eq('id', prestamo_id)
      .single();
    if (fetchError) throw fetchError;

    await supabase
      .from('prestamos')
      .update({ estado: 'renovado' })
      .eq('id', prestamo_id);

    const nuevoMonto = parseFloat(prestamo.saldo_pendiente);
    const nuevoTotal = nuevoMonto * 1.20;
    const nuevaCuota = nuevoTotal / dias_plazo;

    const fechaInicio = new Date();
    const fechaFin    = new Date();
    fechaFin.setDate(fechaInicio.getDate() + dias_plazo);

    const { error: newLoanError } = await supabase
      .from('prestamos')
      .insert([{
        cliente_id:      prestamo.clientes.id,
        cobrador_id,
        monto_prestado:  nuevoMonto,
        monto_total:     nuevoTotal,
        saldo_pendiente: nuevoTotal,
        cuota_diaria:    nuevaCuota,
        fecha_inicio:    fechaInicio.toISOString(),
        fecha_fin:       fechaFin.toISOString(),
        estado:          'activo',
      }]);
    if (newLoanError) throw newLoanError;

    res.status(201).json({ message: 'Préstamo renovado exitosamente' });
  } catch (error) {
    console.error('❌ Error al renovar:', error.message);
    res.status(400).json({ error: error.message });
  }
};

module.exports = { registerPayment, getPaymentHistory, getActiveLoans, renewLoan };