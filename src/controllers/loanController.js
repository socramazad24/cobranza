const getSupabase = require('../config/supabaseClient');

const createLoan = async (req, res) => {
  const supabase = getSupabase();

  const {
    cliente_nombre,
    cliente_telefono,
    cliente_direccion,
    monto_prestado,
    monto_total,
    dias_plazo,
    cobrador_id,
    ruta_id,
    ruta_nombre,
  } = req.body;

  const responsable_id = req.user.rol === 'admin' ? cobrador_id : req.user.id;

  const montoPrestado = Number(monto_prestado);
  const montoTotalManual =
    monto_total == null || monto_total === '' ? null : Number(monto_total);
  const diasPlazo = Number(dias_plazo);

  if (!cliente_nombre || cliente_nombre.trim().length < 3) {
    return res.status(400).json({ error: 'cliente_nombre es requerido' });
  }

  if (!responsable_id) {
    return res.status(400).json({ error: 'cobrador_id es requerido' });
  }

  if (Number.isNaN(montoPrestado) || montoPrestado <= 0) {
    return res.status(400).json({ error: 'monto_prestado inválido' });
  }

  if (Number.isNaN(diasPlazo) || diasPlazo < 7 || diasPlazo > 60) {
    return res.status(400).json({ error: 'El plazo debe ser entre 7 y 60 días' });
  }

  if (
    montoTotalManual != null &&
    (Number.isNaN(montoTotalManual) || montoTotalManual <= montoPrestado)
  ) {
    return res.status(400).json({
      error: 'monto_total debe ser mayor que monto_prestado',
    });
  }

  try {
    let rutaIdFinal = ruta_id ?? null;

    if (!rutaIdFinal && ruta_nombre) {
      const { data: rutaExistente, error: rutaFindError } = await supabase
        .from('rutas')
        .select('id')
        .ilike('nombre', ruta_nombre)
        .maybeSingle();

      if (rutaFindError) throw rutaFindError;

      if (rutaExistente) {
        rutaIdFinal = rutaExistente.id;
      } else {
        const { data: nuevaRuta, error: rutaInsertError } = await supabase
          .from('rutas')
          .insert([{ nombre: ruta_nombre }])
          .select()
          .single();

        if (rutaInsertError) throw rutaInsertError;

        rutaIdFinal = nuevaRuta.id;

        const { error: asignacionError } = await supabase
          .from('cobrador_rutas')
          .insert([
            {
              cobrador_id: responsable_id,
              ruta_id: rutaIdFinal,
            },
          ]);

        if (asignacionError) throw asignacionError;
      }
    }

    const { data: clienteData, error: clienteError } = await supabase
      .from('clientes')
      .insert([
        {
          nombre: cliente_nombre.trim(),
          telefono: cliente_telefono || null,
          direccion: cliente_direccion || null,
          cobrador_id: responsable_id,
          ruta_id: rutaIdFinal,
        },
      ])
      .select()
      .single();

    if (clienteError) throw clienteError;

    const montoTotalFinal =
      montoTotalManual != null ? montoTotalManual : montoPrestado * 1.2;

    const cuotaDiaria = montoTotalFinal / diasPlazo;

    const fechaInicio = new Date();
    const fechaFin = new Date();
    fechaFin.setDate(fechaInicio.getDate() + diasPlazo);

    const { data: prestamoData, error: prestamoError } = await supabase
      .from('prestamos')
      .insert([
        {
          cliente_id: clienteData.id,
          cobrador_id: responsable_id,
          monto_prestado: montoPrestado,
          monto_total: montoTotalFinal,
          saldo_pendiente: montoTotalFinal,
          cuota_diaria: cuotaDiaria,
          fecha_inicio: fechaInicio.toISOString(),
          fecha_fin: fechaFin.toISOString(),
          estado: 'activo',
        },
      ])
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

const updateLoan = async (req, res) => {
  const supabase = getSupabase();
  const { id } = req.params;
  const { monto_prestado, saldo_pendiente, fecha_fin } = req.body;

  const montoPrestado = Number(monto_prestado);
  const saldoPendiente = Number(saldo_pendiente);

  if (Number.isNaN(montoPrestado) || montoPrestado <= 0) {
    return res.status(400).json({ error: 'monto_prestado inválido' });
  }

  if (Number.isNaN(saldoPendiente) || saldoPendiente <= 0) {
    return res.status(400).json({ error: 'saldo_pendiente inválido' });
  }

  if (saldoPendiente > montoPrestado * 1.2) {
    return res.status(400).json({
      error: 'saldo_pendiente no puede superar el 120% del monto prestado',
    });
  }

  if (!fecha_fin) {
    return res.status(400).json({ error: 'fecha_fin es requerida' });
  }

  try {
    const montoTotal = montoPrestado * 1.2;

    const { data: prestamoActual, error: fetchError } = await supabase
      .from('prestamos')
      .select('id, fecha_inicio')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;

    const fechaInicio = new Date(prestamoActual.fecha_inicio);
    const fechaFin = new Date(fecha_fin);

    const diffMs = fechaFin.setHours(0, 0, 0, 0) - new Date(fechaInicio).setHours(0, 0, 0, 0);
    const diasPlazo = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    const cuotaDiaria = montoTotal / diasPlazo;

    const nuevoEstado = saldoPendiente <= 0 ? 'pagado' : 'activo';

    const { error: updateError } = await supabase
      .from('prestamos')
      .update({
        monto_prestado: montoPrestado,
        monto_total: montoTotal,
        saldo_pendiente: saldoPendiente,
        cuota_diaria: cuotaDiaria,
        fecha_fin,
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
    const cobrador_id = rol === 'admin' ? null : req.user.id;

    const { data, error } = await supabase.rpc('obtener_clientes_morosos', {
      p_cobrador_id: cobrador_id,
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

module.exports = {
  createLoan,
  updateLoan,
  getClavos,
};