// src/controllers/clientController.js
const getSupabase = require('../config/supabaseClient');

const getClientes = async (req, res) => {
  const supabase = getSupabase();
  const rol = req.user.rol;
  const usuarioid = req.user.id;
  const filtrocobrador = rol === 'admin'
    ? req.query.cobradorid
    : (req.query.cobradorid || usuarioid);

  // Búsqueda por texto
  const search = (req.query.search || req.query.q || '').toString().trim();

  console.log('🔍 getClientes - search:', JSON.stringify(search), 'cobrador:', filtrocobrador);

  try {
    // PASO 1: Búsqueda simple SIN joins (más confiable)
    let query = supabase
      .from('clientes')
      .select('id, nombre, telefono, direccion, informacion_contacto, created_at, cobrador_id, ruta_id')
      .order('nombre', { ascending: true });

    if (filtrocobrador) {
      query = query.eq('cobrador_id', filtrocobrador);
    }

    if (search.length >= 2) {
      const searchPattern = `%${search}%`;
      query = query.or(`nombre.ilike.${searchPattern},telefono.ilike.${searchPattern},direccion.ilike.${searchPattern}`);
    }

    const { data, error } = await query;
    if (error) {
      console.error('❌ Error en getClientes:', error);
      return res.status(400).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      console.log('📊 Sin resultados');
      return res.json([]);
    }

    // PASO 2: Traer los nombres de cobradores MANUALMENTE
    const cobradoresIds = [...new Set(data.map(c => c.cobrador_id).filter(id => id != null))];
    let cobradoresMap = {};
    if (cobradoresIds.length > 0) {
      const { data: cobradoresData } = await supabase
        .from('usuarios')
        .select('id, nombre')
        .in('id', cobradoresIds);
      for (const c of (cobradoresData ?? [])) {
        cobradoresMap[c.id] = c.nombre;
      }
    }

    // PASO 3: Traer los nombres de rutas MANUALMENTE
    const rutasIds = [...new Set(data.map(c => c.ruta_id).filter(id => id != null))];
    let rutasMap = {};
    if (rutasIds.length > 0) {
      const { data: rutasData } = await supabase
        .from('rutas')
        .select('id, nombre')
        .in('id', rutasIds);
      for (const r of (rutasData ?? [])) {
        rutasMap[r.id] = r.nombre;
      }
    }

    // PASO 4: Traer los préstamos de los clientes
    const clienteIds = data.map(c => c.id);
    let prestamosPorCliente = {};
    if (clienteIds.length > 0) {
      const { data: prestamosData } = await supabase
        .from('prestamos')
        .select('id, estado, saldo_pendiente, monto_total, cliente_id')
        .in('cliente_id', clienteIds);
      
      for (const p of (prestamosData ?? [])) {
        if (!prestamosPorCliente[p.cliente_id]) {
          prestamosPorCliente[p.cliente_id] = [];
        }
        prestamosPorCliente[p.cliente_id].push(p);
      }
    }

    // PASO 5: Armar respuesta
    const clientes = data.map(c => {
      const prestamos = prestamosPorCliente[c.id] || [];
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
        cobradornombre: cobradoresMap[c.cobrador_id] ?? 'Sin cobrador',  // 🆕 Ahora sí muestra el nombre
        rutaid: c.ruta_id,
        rutanombre: rutasMap[c.ruta_id] ?? 'Sin ruta',
        totalprestamos: prestamos.length,
        prestamosactivos: activos.length,
        saldopendiente,
        tienemora,
      };
    });

    console.log(`📊 Clientes devueltos: ${clientes.length}`);
    return res.json(clientes);
  } catch (err) {
    console.error('❌ Error en getClientes:', err);
    return res.status(500).json({ error: err.message });
  }
};

const getCobradores = async (req, res) => {
  const supabase = getSupabase();
  const search = (req.query.search || req.query.q || '').toString().trim();

  try {
    let query = supabase
      .from('usuarios')
      .select('id, nombre')
      .eq('rol', 'cobrador')
      .order('nombre');

    // 🆕 Si hay búsqueda, filtrar
    if (search.length >= 2) {
      query = query.ilike('nombre', `%${search}%`);
    }

    const { data, error } = await query;
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
    const { data: clientesExisten, error: checkError } = await supabase
      .from('clientes')
      .select('id')
      .in('id', clienteids);

    if (checkError) throw checkError;

    if (!clientesExisten || clientesExisten.length === 0) {
      return res.status(404).json({ error: 'No se encontraron los clientes indicados' });
    }

    const { data: prestamos, error: prestamosError } = await supabase
      .from('prestamos')
      .select('id')
      .in('cliente_id', clienteids);

    if (prestamosError) throw prestamosError;

    if (prestamos && prestamos.length > 0) {
      const prestamoIds = prestamos.map(p => p.id);

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
