// controllers/clientController.js
const getSupabase = require('../config/supabaseClient');

const getClientes = async (req, res) => {
  const supabase    = getSupabase();
  const rol         = req.user.rol;
  const usuario_id  = req.user.id;

  // Admin puede filtrar por cobrador_id via query param
  // Cobrador solo ve sus propios clientes
  const filtro_cobrador = rol === 'admin'
    ? (req.query.cobrador_id || null)
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

    // Enriquecer cada cliente con resumen de préstamos
    const clientes = (data ?? []).map(c => {
      const prestamos       = c.prestamos ?? [];
      const activos         = prestamos.filter(p => p.estado === 'activo');
      const saldo_pendiente = activos.reduce((sum, p) => sum + Number(p.saldo_pendiente), 0);
      const tiene_mora      = activos.some(p => p.estado === 'mora');

      return {
        id:                   c.id,
        nombre:               c.nombre,
        telefono:             c.telefono,
        direccion:            c.direccion,
        informacion_contacto: c.informacion_contacto,
        created_at:           c.created_at,
        cobrador_id:          c.cobrador_id,
        cobrador_nombre:      c.usuarios?.nombre ?? 'Sin cobrador',
        ruta_nombre:          c.rutas?.nombre    ?? 'Sin ruta',
        total_prestamos:      prestamos.length,
        prestamos_activos:    activos.length,
        saldo_pendiente,
        tiene_mora,
      };
    });

    return res.json(clientes);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// Admin también necesita la lista de cobradores para el filtro
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

module.exports = { getClientes, getCobradores };