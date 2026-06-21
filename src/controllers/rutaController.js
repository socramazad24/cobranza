// src/controllers/rutaController.js
const getSupabase = require('../config/supabaseClient');

// Listar todas las rutas
const getRutas = async (req, res) => {
    const supabase = getSupabase();
    const { data, error } = await supabase
        .from('rutas')
        .select('*')
        .order('nombre', { ascending: true });

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
};

// Crear una ruta nueva
const createRuta = async (req, res) => {
    const supabase = getSupabase();
    const { nombre, descripcion } = req.body;

    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });

    // Verificar que no exista una ruta con el mismo nombre
    const { data: existe } = await supabase
        .from('rutas')
        .select('id')
        .ilike('nombre', nombre)
        .single();

    if (existe) return res.status(400).json({ error: 'Ya existe una ruta con ese nombre' });

    const { data, error } = await supabase
        .from('rutas')
        .insert([{ nombre, descripcion }])
        .select()
        .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
};

// Editar ruta
const updateRuta = async (req, res) => {
    const supabase = getSupabase();
    const { id } = req.params;
    const { nombre, descripcion } = req.body;

    const { error } = await supabase
        .from('rutas')
        .update({ nombre, descripcion })
        .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Ruta actualizada correctamente' });
};

const deleteRuta = async (req, res) => {
  const supabase = getSupabase();
  const { id } = req.params;

  try {
    // 1. Obtener todos los clientes de esta ruta
    const { data: clientes, error: clientesError } = await supabase
      .from('clientes')
      .select('id')
      .eq('ruta_id', id);

    if (clientesError) throw clientesError;

    if (clientes && clientes.length > 0) {
      const clienteIds = clientes.map(c => c.id);

      // 2. Obtener préstamos de esos clientes
      const { data: prestamos, error: prestamosError } = await supabase
        .from('prestamos')
        .select('id')
        .in('cliente_id', clienteIds);

      if (prestamosError) throw prestamosError;

      if (prestamos && prestamos.length > 0) {
        const prestamoIds = prestamos.map(p => p.id);

        // 3. Borrar pagos de esos préstamos
        const { error: pagosError } = await supabase
          .from('pagos')
          .delete()
          .in('prestamo_id', prestamoIds);

        if (pagosError) throw pagosError;

        // 4. Borrar observaciones de esos préstamos
        const { error: obsError } = await supabase
          .from('observaciones')
          .delete()
          .in('referencia_id', prestamoIds);

        if (obsError) throw obsError;

        // 5. Borrar los préstamos
        const { error: delPrestamosError } = await supabase
          .from('prestamos')
          .delete()
          .in('id', prestamoIds);

        if (delPrestamosError) throw delPrestamosError;
      }

      // 6. Borrar los clientes
      const { error: delClientesError } = await supabase
        .from('clientes')
        .delete()
        .in('id', clienteIds);

      if (delClientesError) throw delClientesError;
    }

    // 7. Borrar relaciones cobrador_rutas
    const { error: cobradorRutasError } = await supabase
      .from('cobrador_rutas')
      .delete()
      .eq('ruta_id', id);

    if (cobradorRutasError) throw cobradorRutasError;

    // 8. Borrar la ruta
    const { error } = await supabase
      .from('rutas')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({
      message: 'Ruta eliminada correctamente',
      clientes_eliminados: clientes?.length ?? 0,
    });

  } catch (error) {
    console.error('Error deleteRuta:', error.message);
    res.status(400).json({ error: error.message });
  }
};

// Asignar una o más rutas a un cobrador
const asignarRutas = async (req, res) => {
    const supabase = getSupabase();
    const { cobrador_id, ruta_ids } = req.body;
    // ruta_ids es un array de IDs: [1, 2, 3]

    if (!cobrador_id || !ruta_ids || ruta_ids.length === 0) {
        return res.status(400).json({ error: 'cobrador_id y ruta_ids son requeridos' });
    }

    try {
        // Primero eliminamos las rutas actuales del cobrador
        await supabase
            .from('cobrador_rutas')
            .delete()
            .eq('cobrador_id', cobrador_id);

        // Luego insertamos las nuevas rutas asignadas
        const inserts = ruta_ids.map(ruta_id => ({ cobrador_id, ruta_id }));
        const { error } = await supabase
            .from('cobrador_rutas')
            .insert(inserts);

        if (error) throw error;
        res.json({ message: 'Rutas asignadas correctamente' });
    } catch (error) {
        console.error('❌ Error asignando rutas:', error.message);
        res.status(400).json({ error: error.message });
    }
};

// Obtener rutas asignadas a un cobrador específico
const getRutasCobrador = async (req, res) => {
    const supabase = getSupabase();
    const { cobrador_id } = req.params;

    const { data, error } = await supabase
        .from('cobrador_rutas')
        .select(`
            ruta_id,
            rutas (id, nombre, descripcion)
        `)
        .eq('cobrador_id', cobrador_id);

    if (error) return res.status(400).json({ error: error.message });

    // Simplificamos el resultado para Flutter
    const rutas = data.map(item => item.rutas);
    res.json(rutas);
};


// GET /api/rutas/:id/resumen — cuántos registros se borrarán en cascada
const getResumenRuta = async (req, res) => {
  const supabase = getSupabase();
  const { id } = req.params;

  try {
    // Datos de la ruta
    const { data: ruta, error: rutaError } = await supabase
      .from('rutas')
      .select('id, nombre')
      .eq('id', id)
      .single();

    if (rutaError) throw rutaError;

    // Clientes de la ruta
    const { data: clientes, error: clientesError } = await supabase
      .from('clientes')
      .select('id, nombre')
      .eq('ruta_id', id);

    if (clientesError) throw clientesError;

    let totalPrestamos = 0;
    let totalPagos = 0;
    let prestamosActivos = 0;

    if (clientes && clientes.length > 0) {
      const clienteIds = clientes.map(c => c.id);

      const { data: prestamos, error: prestamosError } = await supabase
        .from('prestamos')
        .select('id, estado')
        .in('cliente_id', clienteIds);

      if (prestamosError) throw prestamosError;

      totalPrestamos = prestamos?.length ?? 0;
      prestamosActivos = prestamos?.filter(p => p.estado === 'activo').length ?? 0;

      if (prestamos && prestamos.length > 0) {
        const prestamoIds = prestamos.map(p => p.id);

        const { count, error: pagosError } = await supabase
          .from('pagos')
          .select('id', { count: 'exact', head: true })
          .in('prestamo_id', prestamoIds);

        if (pagosError) throw pagosError;
        totalPagos = count ?? 0;
      }
    }

    res.json({
      ruta: { id: ruta.id, nombre: ruta.nombre },
      resumen: {
        clientes:           clientes?.length ?? 0,
        prestamos_total:    totalPrestamos,
        prestamos_activos:  prestamosActivos,
        pagos:              totalPagos,
      },
      advertencia: prestamosActivos > 0
        ? `⚠️ Hay ${prestamosActivos} préstamo(s) activo(s) que se perderán`
        : null,
    });

  } catch (error) {
    console.error('Error getResumenRuta:', error.message);
    res.status(400).json({ error: error.message });
  }
};


module.exports = { getRutas, createRuta, updateRuta, deleteRuta, asignarRutas, getRutasCobrador };