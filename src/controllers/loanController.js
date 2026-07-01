const getSupabase = require('../config/supabaseClient');

const createLoan = async (req, res) => {
  const supabase = getSupabase();
  const {
    clientenombre, clientetelefono, clientedireccion,
    montoprestado, montototal, diasplazo,
    cobradorid, rutaid, rutanombre,
  } = req.body;

  const responsableid = req.user.rol === 'admin' ? cobradorid : req.user.id;
  const montoPrestado = Number(montoprestado);
  const montoTotalManual = (montototal === null || montototal === undefined) ? null : Number(montototal);
  const diasPlazo = Number(diasplazo);

  // Trim correcto para nombres con letras latinas y tildes
  const nombreTrimmed = (clientenombre ?? '').replace(/\s+/g, ' ').trim();
  if (!nombreTrimmed || nombreTrimmed.length < 3)
    return res.status(400).json({ error: 'clientenombre es requerido (mín. 3 caracteres)' });

  if (!responsableid)
    return res.status(400).json({ error: 'cobradorid es requerido' });

  if (isNaN(montoPrestado) || montoPrestado <= 0)
    return res.status(400).json({ error: 'montoprestado inválido' });

  if (isNaN(diasPlazo) || diasPlazo < 7 || diasPlazo > 60)
    return res.status(400).json({ error: 'El plazo debe ser entre 7 y 60 días' });

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
      await supabase.from('cobrador_rutas').insert({
        cobrador_id: responsableid,
        ruta_id: rutaIdFinal,
      });
      // ignoramos error de duplicado por unique constraint
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
    const cuotaDiaria = montoTotalFinal / diasPlazo;
    const fechaInicio = new Date();
    const fechaFin = new Date();
    fechaFin.setDate(fechaInicio.getDate() + diasPlazo);

    const { data: prestamoData, error: prestamoError } = await supabase
      .from('prestamos')
      .insert({
        cliente_id: clienteData.id,
        cobrador_id: responsableid,
        monto_prestado: montoPrestado,
        monto_total: montoTotalFinal,
        saldo_pendiente: montoTotalFinal,
        cuota_diaria: cuotaDiaria,
        fecha_inicio: fechaInicio.toISOString(),
        fecha_fin: fechaFin.toISOString(),
        estado: 'activo',
      })
      .select()
      .single();

    if (prestamoError) throw prestamoError;

    return res.status(201).json({
      message: 'Préstamo creado exitosamente',
      cliente: clienteData,
      prestamo: prestamoData,
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
      const nombreTrimmed = String(p.clientenombre ?? '').replace(/\s+/g, ' ').trim();

      if (!nombreTrimmed || nombreTrimmed.length < 3) throw new Error('clientenombre inválido');
      if (isNaN(montoPrestado) || montoPrestado <= 0) throw new Error('montoprestado inválido');
      if (isNaN(diasPlazo) || diasPlazo < 7 || diasPlazo > 60)
        throw new Error('diasplazo debe ser entre 7 y 60');

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
        await supabase.from('cobrador_rutas').insert({
          cobrador_id: responsableid,
          ruta_id: rutaIdFinal,
        });
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

      const cuotaDiaria = montoTotalFinal / diasPlazo;
      const fechaInicio = new Date();
      const fechaFin = new Date();
      fechaFin.setDate(fechaInicio.getDate() + diasPlazo);

      const { error: prestamoError } = await supabase.from('prestamos').insert({
        cliente_id: clienteData.id,
        cobrador_id: responsableid,
        monto_prestado: montoPrestado,
        monto_total: montoTotalFinal,
        saldo_pendiente: montoTotalFinal,
        cuota_diaria: cuotaDiaria,
        fecha_inicio: fechaInicio.toISOString(),
        fecha_fin: fechaFin.toISOString(),
        estado: 'activo',
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
      .from('prestamos').select('id, fecha_inicio').eq('id', id).single();
    if (fetchError) throw fetchError;

    const diffMs =
      new Date(fechafin).setHours(0, 0, 0, 0) -
      new Date(prestamoActual.fecha_inicio).setHours(0, 0, 0, 0);
    const diasPlazo = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    const cuotaDiaria = montoTotal / diasPlazo;
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
        id,
        cliente_id,
        cobrador_id,
        monto_prestado,
        monto_total,
        saldo_pendiente,
        cuota_diaria,
        fecha_inicio,
        fecha_fin,
        estado,
        created_at,
        clientes (
          id,
          nombre,
          telefono,
          direccion,
          ruta_id,
          rutas (
            id,
            nombre
          )
        ),
        usuarios!prestamos_cobrador_id_fkey (
          id,
          nombre
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
      created_at: p.created_at,
    }));

    return res.json(prestamos);
  } catch (error) {
    console.error("Error getLoansByCobrador:", error.message);
    return res.status(400).json({ error: error.message });
  }
};

module.exports = {
  createLoan,
  updateLoan,
  getClavos,
  importarPrestamos,
  getLoansByCobrador,
};