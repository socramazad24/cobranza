const getSupabase = require('../config/supabaseClient');

const getClientes = async (req, res) => {
  const supabase = getSupabase();
  const rol = req.user.rol;
  const usuarioid = req.user.id;
  const filtrocobrador = rol === 'admin'
    ? req.query.cobradorid
    : (req.query.cobradorid || usuarioid);

  try {
    let query = supabase
      .from('clientes')
      .select(`
        id, nombre, telefono, direccion, informacion_contacto, created_at,
        cobrador_id, ruta_id,
        usuarios!clientes_cobrador_id_fkey ( id, nombre ),
        rutas ( id, nombre ),
        prestamos ( id, estado, saldo_pendiente, monto_total, fecha_fin )
      `)
      .order('nombre', { ascending: true });

    if (filtrocobrador) query = query.eq('cobrador_id', filtrocobrador);

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    const clientes = (data ?? []).map(c => {
      const prestamos = c.prestamos ?? [];
      const activos = prestamos.filter(p => p.estado === 'activo' || p.estado === 'mora');
      const saldopendiente = activos.reduce((sum, p) => sum + Number(p.saldo_pendiente || 0), 0);
      const tienemora = prestamos.some(p => p.estado === 'mora');
      return {
        id: c.id,
        nombre: c.nombre,
        telefono: c.telefono,
        direccion: c.direccion,
        informacioncontacto: c.informacion_contacto,
        createdat: c.created_at,
        cobradorid: c.cobrador_id,
        cobradornombre: c.usuarios?.nombre ?? 'Sin cobrador',
        rutaid: c.ruta_id,
        rutanombre: c.rutas?.nombre ?? 'Sin ruta',
        totalprestamos: prestamos.length,
        prestamosactivos: activos.length,
        saldopendiente,
        tienemora,
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
  const clienteids = req.body.clienteids || req.body.clienteIds;

  if (!clienteids || !Array.isArray(clienteids) || clienteids.length === 0) {
    return res.status(400).json({ error: 'Debes enviar al menos un clienteid' });
  }

  try {
    // Verificar que los clientes existen
    const { data: clientesExisten, error: checkError } = await supabase
      .from('clientes')
      .select('id')
      .in('id', clienteids);

    if (checkError) throw checkError;

    if (!clientesExisten || clientesExisten.length === 0) {
      return res.status(404).json({ error: 'No se encontraron los clientes indicados' });
    }

    // Los préstamos tienen on delete CASCADE desde clientes,
    // y pagos + observaciones tienen on delete CASCADE desde préstamos,
    // así que basta con borrar los clientes directamente.
    // Solo necesitamos borrar préstamos explícitamente porque Supabase JS
    // no siempre ejecuta el CASCADE en queries encadenadas por la API.
    // Hacemos el borrado manual para mayor control y logging.

    // 1. Obtener IDs de préstamos de esos clientes
    const { data: prestamos, error: prestamosError } = await supabase
      .from('prestamos')
      .select('id')
      .in('cliente_id', clienteids);

    if (prestamosError) throw prestamosError;

    if (prestamos && prestamos.length > 0) {
      const prestamoIds = prestamos.map(p => p.id);

      // 2. Borrar pagos (tiene on delete CASCADE pero lo hacemos explícito)
      const { error: pagosError } = await supabase
        .from('pagos')
        .delete()
        .in('prestamo_id', prestamoIds);
      if (pagosError) throw pagosError;

      // 3. Borrar observaciones (tiene on delete CASCADE pero lo hacemos explícito)
      const { error: obsError } = await supabase
        .from('observaciones')
        .delete()
        .in('referencia_id', prestamoIds);
      if (obsError) throw obsError;

      // 4. Borrar préstamos
      const { error: delPrestamosError } = await supabase
        .from('prestamos')
        .delete()
        .in('id', prestamoIds);
      if (delPrestamosError) throw delPrestamosError;
    }

    // 5. Borrar los clientes
    const { error: delClientesError } = await supabase
      .from('clientes')
      .delete()
      .in('id', clienteids);
    if (delClientesError) throw delClientesError;

    return res.json({
      message: 'Clientes eliminados correctamente',
      eliminados: clientesExisten.length,
    });
  } catch (error) {
    console.error('Error deleteClientes:', error.message);
    return res.status(400).json({ error: error.message });
  }
};

module.exports = { getClientes, getCobradores, deleteClientes };