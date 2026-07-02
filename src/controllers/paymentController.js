// src/controllers/paymentController.js
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
    // 1. Obtener el préstamo
    const { data: prestamo, error: fetchError } = await supabase
      .from('prestamos')
      .select('id, saldo_pendiente, estado, cobrador_id, frecuencia, total_pagos_programados, pagos_realizados')
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

    // 2. Registrar el pago en la tabla 'pagos'
    const { data: pago, error: pagoError } = await supabase
      .from('pagos')
      .insert({
        prestamo_id: prestamoid,
        cobrador_id: cobradorid,
        monto_pagado: montoIngresado,
      })
      .select()
      .single();

    if (pagoError) throw pagoError;

    // 3. Actualizar saldo y estado del préstamo
    const nuevoSaldo = saldoActual - montoIngresado;
    const saldoFinal = nuevoSaldo < 0 ? 0 : nuevoSaldo;
    const nuevoEstado = saldoFinal === 0 ? 'pagado' : 'activo';

    const { error: updatePrestamoError } = await supabase
      .from('prestamos')
      .update({ saldo_pendiente: saldoFinal, estado: nuevoEstado })
      .eq('id', prestamoid);

    if (updatePrestamoError) throw updatePrestamoError;

    // ═══════════════════════════════════════════════════════════════
    // 4. Marcar pagos programados como pagados (CON LOGGING)
    // ═══════════════════════════════════════════════════════════════
    try {
      const hoy = new Date().toISOString().split('T')[0];
      console.log(`🔍 [PP] === INICIO marcar pagos programados ===`);
      console.log(`🔍 [PP] Préstamo ID: ${prestamoid}, Fecha hoy: ${hoy}`);

      // Ver todos los pagos programados del préstamo
      const { data: todosPP, error: errTodos } = await supabase
        .from('pagos_programados')
        .select('id, numero_pago, fecha_programada, monto_esperado, pagado')
        .eq('prestamo_id', prestamoid)
        .order('numero_pago', { ascending: true });

      if (errTodos) {
        console.log(`❌ [PP] Error al buscar todos: ${errTodos.message}`);
      } else {
        console.log(`🔍 [PP] Total pagos programados: ${todosPP?.length ?? 0}`);
        if (todosPP && todosPP.length > 0) {
          for (const pp of todosPP) {
            console.log(`  → #${pp.numero_pago}: ${pp.fecha_programada} | pagado=${pp.pagado} | $${pp.monto_esperado}`);
          }
        }
      }

      // Buscar SOLO los pendientes
      const { data: ppPendientes, error: ppErr } = await supabase
        .from('pagos_programados')
        .select('id, numero_pago, fecha_programada, monto_esperado')
        .eq('prestamo_id', prestamoid)
        .eq('pagado', false)
        .order('numero_pago', { ascending: true });

      if (ppErr) {
        console.log(`❌ [PP] Error al buscar pendientes: ${ppErr.message}`);
      } else {
        console.log(`🔍 [PP] Pagos PENDIENTES: ${ppPendientes?.length ?? 0}`);

        if (ppPendientes && ppPendientes.length > 0) {
          // Marcar los que correspondan a hoy o antes
          const ppAMarcar = ppPendientes
            .filter(pp => pp.fecha_programada <= hoy)
            .map(pp => pp.id);

          console.log(`🔍 [PP] IDs a marcar (fechas <= ${hoy}): [${ppAMarcar.join(', ')}]`);

          if (ppAMarcar.length > 0) {
            const { data: updated, error: updatePPError } = await supabase
              .from('pagos_programados')
              .update({
                pagado: true,
                fecha_pago_real: new Date().toISOString(),
              })
              .in('id', ppAMarcar)
              .select();

            if (updatePPError) {
              console.log(`❌ [PP] Error al actualizar: ${updatePPError.message}`);
            } else {
              console.log(`✅ [PP] ${updated?.length ?? 0} pago(s) actualizado(s)`);
              if (updated) {
                for (const u of updated) {
                  console.log(`  ✓ #${u.numero_pago} ahora pagado=${u.pagado}`);
                }
              }
            }
          } else {
            console.log(`⚠️ [PP] No hay pagos con fecha <= ${hoy} para marcar`);
          }
        }
      }

      // Actualizar contador en el préstamo
      const { count: totalPagados, error: countErr } = await supabase
        .from('pagos_programados')
        .select('id', { count: 'exact', head: true })
        .eq('prestamo_id', prestamoid)
        .eq('pagado', true);

      if (countErr) {
        console.log(`❌ [PP] Error al contar: ${countErr.message}`);
      } else {
        const { error: updateCountErr } = await supabase
          .from('prestamos')
          .update({ pagos_realizados: totalPagados ?? 0 })
          .eq('id', prestamoid);

        if (updateCountErr) {
          console.log(`❌ [PP] Error al actualizar contador: ${updateCountErr.message}`);
        } else {
          console.log(`✅ [PP] Contador: ${totalPagados} pagos realizados`);
        }
      }

      console.log(`🔍 [PP] === FIN ===`);
    } catch (ppError) {
      console.log(`❌ [PP] Error general: ${ppError.message}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // 5. Crear o actualizar caja del día
    // ═══════════════════════════════════════════════════════════════
    const fecha = new Date().toISOString().split('T')[0];

    const { data: cajaExistente, error: cajaError } = await supabase
      .from('caja_diaria')
      .select('id, base_entregada, total_cobrado, total_entregado, diferencia')
      .eq('cobrador_id', cobradorid)
      .eq('fecha', fecha)
      .maybeSingle();

    if (cajaError) throw cajaError;

    let cajaResult;
    let cajaAccion = 'actualizada';

    if (!cajaExistente) {
      const { data: nuevaCaja, error: insertCajaError } = await supabase
        .from('caja_diaria')
        .insert({
          cobrador_id: cobradorid,
          fecha,
          base_entregada: 0,
          total_cobrado: montoIngresado,
          total_entregado: 0,
          diferencia: montoIngresado,
        })
        .select()
        .single();

      if (insertCajaError) throw insertCajaError;
      cajaResult = nuevaCaja;
      cajaAccion = 'creada';
    } else {
      const baseEntregada = Number(cajaExistente.base_entregada) || 0;
      const nuevoTotalCobrado = (Number(cajaExistente.total_cobrado) || 0) + montoIngresado;
      const totalEntregado = cajaExistente.total_entregado === null
        ? null
        : Number(cajaExistente.total_entregado);

      const cajaCerrada = totalEntregado !== null;
      const nuevoTotalEntregado = cajaCerrada ? 0 : totalEntregado;
      const nuevaDiferencia = cajaCerrada
        ? baseEntregada + nuevoTotalCobrado
        : baseEntregada + nuevoTotalCobrado - (totalEntregado || 0);

      const { data: cajaActualizada, error: updateCajaError } = await supabase
        .from('caja_diaria')
        .update({
          total_cobrado: nuevoTotalCobrado,
          total_entregado: nuevoTotalEntregado,
          diferencia: nuevaDiferencia,
          cerrado_por: cajaCerrada ? null : cajaExistente.cerrado_por,
        })
        .eq('id', cajaExistente.id)
        .select()
        .single();

      if (updateCajaError) throw updateCajaError;
      cajaResult = cajaActualizada;
      cajaAccion = cajaCerrada ? 'reabierta_y_actualizada' : 'actualizada';
    }

    return res.status(201).json({
      message: 'Pago registrado',
      pago,
      saldorestante: saldoFinal,
      estado: nuevoEstado,
      fechapago: pago?.fecha_pago ?? new Date().toISOString(),
      caja: {
        accion: cajaAccion,
        id: cajaResult.id,
        total_cobrado: Number(cajaResult.total_cobrado) || 0,
        total_entregado: cajaResult.total_entregado === null ? null : Number(cajaResult.total_entregado),
        diferencia: Number(cajaResult.diferencia) || 0,
      },
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
      fecha_inicio, fecha_fin, estado, cobrador_id, frecuencia,
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

const getPagosDelDia = async (req, res) => {
  const supabase = getSupabase();
  const prestamoid = req.params.prestamoid;
  const cobradorid = req.user.id;

  if (!prestamoid) {
    return res.status(400).json({ error: 'prestamoid es requerido' });
  }

  const hoy = new Date();
  const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 0, 0);
  const finHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);

  try {
    const { data, error } = await supabase
      .from('pagos')
      .select('id, monto_pagado, fecha_pago, cobrador_id')
      .eq('prestamo_id', prestamoid)
      .gte('fecha_pago', inicioHoy.toISOString())
      .lte('fecha_pago', finHoy.toISOString())
      .order('fecha_pago', { ascending: false });

    if (error) throw error;

    const pagosCobrador = (data ?? []).filter(p =>
      String(p.cobrador_id) === String(cobradorid) || req.user.rol === 'admin'
    );

    const totalCobradoHoy = pagosCobrador.reduce(
      (sum, p) => sum + Number(p.monto_pagado || 0), 0
    );

    return res.json({
      prestamo_id: prestamoid,
      fecha: hoy.toISOString().split('T')[0],
      total_cobrado_hoy: totalCobradoHoy,
      cantidad_pagos: pagosCobrador.length,
      pagos: pagosCobrador.map(p => ({
        id: p.id,
        monto: Number(p.monto_pagado) || 0,
        fecha: p.fecha_pago,
      })),
    });
  } catch (error) {
    console.error('Error getPagosDelDia:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

module.exports = {
  registerPayment,
  getPaymentHistory,
  getActiveLoans,
  renewLoan,
  getPagosDelDia,
};
