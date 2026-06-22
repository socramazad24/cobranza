const getSupabase = require('../config/supabaseClient');

const getClientes = async (req, res) => {
  const supabase = getSupabase();
  const rol = req.user.rol;
  const usuario_id = req.user.id;

  const filtro_cobrador =
    rol === 'admin'
      ? (req.query.cobrador_id || req.query.cobradorid || null)
      : usuario_id;

  try {
    let query = supabase
      .from('clientes')
      .select(`
        id,
        nombre,
        telefono,
        direccion,
        informacion_contacto,
        created_at,
        cobrador_id,
        ruta_id,
        usuarios!clientes_cobrador_id_fkey ( id, nombre ),
        rutas ( id, nombre ),
        prestamos ( id, estado, saldo_pendiente, monto_total, fecha_fin )
      `)
      .order('nombre', { ascending: true });

    if (filtro_cobrador) {
      query = query.eq('cobrador_id', filtro_cobrador);
    }

    const { data, error } = await query;

    if (error) return res.status(400).json({ error: error.message });

    const clientes = (data ?? []).map((c) => {
      const prestamos = c.prestamos ?? [];
      const activos = prestamos.filter(
        (p) => p.estado === 'activo' || p.estado === 'mora'
      );

      const saldo_pendiente = activos.reduce(
        (sum, p) => sum + Number(p.saldo_pendiente || 0),
        0
      );

      const tiene_mora = prestamos.some((p) => p.estado === 'mora');

      return {
        id: c.id,
        nombre: c.nombre,
        telefono: c.telefono,
        direccion: c.direccion,
        informacion_contacto: c.informacion_contacto,
        created_at: c.created_at,
        cobrador_id: c.cobrador_id,
        cobrador_nombre: c.usuarios?.nombre ?? 'Sin cobrador',
        ruta_id: c.ruta_id,
        ruta_nombre: c.rutas?.nombre ?? 'Sin ruta',
        total_prestamos: prestamos.length,
        prestamos_activos: activos.length,
        saldo_pendiente,
        tiene_mora,
      };
    });

    return res.json(clientes);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

const getCobradores = async (req, res) => {
  const supabase = getSupabase();

  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, nombre')
      .eq('rol', 'cobrador')
      .order('nombre');

    if (error) return res.status(400).json({ error: error.message });
    return res.json(data ?? []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

const deleteClientes = async (req, res) => {
  const supabase = getSupabase();
  const cliente_ids = req.body.cliente_ids || req.body.clienteids;

  if (!cliente_ids || cliente_ids.length === 0) {
    return res.status(400).json({ error: 'Debes enviar al menos un cliente_id' });
  }

  try {
    const { data: prestamos, error: prestamosError } = await supabase
      .from('prestamos')
      .select('id')
      .in('cliente_id', cliente_ids);

    if (prestamosError) throw prestamosError;

    if (prestamos && prestamos.length > 0) {
      const prestamoIds = prestamos.map((p) => p.id);

      const { error: pagosError } = await supabase
        .from('pagos')
        .delete()
        .in('prestamo_id', prestamoIds);
      if (pagosError) throw pagosError;

      const { error: obsError } = await supabase
        .from('observaciones')
        .delete()
        .in('referencia_id', prestamoIds);
      if (obsError) throw obsError;

      const { error: delPrestamosError } = await supabase
        .from('prestamos')
        .delete()
        .in('id', prestamoIds);
      if (delPrestamosError) throw delPrestamosError;
    }

    const { error: delClientesError } = await supabase
      .from('clientes')
      .delete()
      .in('id', cliente_ids);
    if (delClientesError) throw delClientesError;

    res.json({
      message: 'Clientes eliminados correctamente',
      eliminados: cliente_ids.length,
    });
  } catch (error) {
    console.error('Error deleteClientes:', error.message);
    res.status(400).json({ error: error.message });
  }
};

module.exports = {
  getClientes,
  getCobradores,
  deleteClientes,
};