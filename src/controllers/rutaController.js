const getSupabase = require('../config/supabaseClient');

const getRutas = async (req, res) => {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('rutas')
    .select('*')
    .order('nombre', { ascending: true });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

const createRuta = async (req, res) => {
  const supabase = getSupabase();
  const { nombre, descripcion } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'El nombre es requerido' });
  }

  const { data: existe, error: existeError } = await supabase
    .from('rutas')
    .select('id')
    .ilike('nombre', nombre)
    .maybeSingle();

  if (existeError) {
    return res.status(400).json({ error: existeError.message });
  }

  if (existe) {
    return res.status(400).json({ error: 'Ya existe una ruta con ese nombre' });
  }

  const { data, error } = await supabase
    .from('rutas')
    .insert({ nombre, descripcion })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.status(201).json(data);
};

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
    // 1. Obtener clientes de esa ruta
    const { data: clientes, error: clientesError } = await supabase
      .from('clientes')
      .select('id')
      .eq('ruta_id', id);

    if (clientesError) throw clientesError;

    const clienteIds = (clientes ?? []).map((c) => c.id);

    if (clienteIds.length > 0) {
      // 2. Obtener préstamos de esos clientes
      const { data: prestamos, error: prestamosError } = await supabase
        .from('prestamos')
        .select('id')
        .in('cliente_id', clienteIds);

      if (prestamosError) throw prestamosError;

      const prestamoIds = (prestamos ?? []).map((p) => p.id);

      if (prestamoIds.length > 0) {
        // 3. Borrar pagos
        const { error: pagosError } = await supabase
          .from('pagos')
          .delete()
          .in('prestamo_id', prestamoIds);

        if (pagosError) throw pagosError;

        // 4. Borrar observaciones solo de préstamos
        const { error: obsError } = await supabase
          .from('observaciones')
          .delete()
          .eq('tipo', 'prestamo')
          .in('referencia_id', prestamoIds);

        if (obsError) throw obsError;

        // 5. Borrar préstamos
        const { error: prestamosDeleteError } = await supabase
          .from('prestamos')
          .delete()
          .in('id', prestamoIds);

        if (prestamosDeleteError) throw prestamosDeleteError;
      }

      // 6. Borrar clientes
      const { error: clientesDeleteError } = await supabase
        .from('clientes')
        .delete()
        .in('id', clienteIds);

      if (clientesDeleteError) throw clientesDeleteError;
    }

    // 7. Borrar asignaciones cobrador-ruta
    const { error: cobradorRutasError } = await supabase
      .from('cobrador_rutas')
      .delete()
      .eq('ruta_id', id);

    if (cobradorRutasError) throw cobradorRutasError;

    // 8. Borrar la ruta
    const { error: rutaDeleteError } = await supabase
      .from('rutas')
      .delete()
      .eq('id', id);

    if (rutaDeleteError) throw rutaDeleteError;

    res.json({
      message: 'Ruta eliminada correctamente',
      clienteseliminados: clienteIds.length,
    });
  } catch (error) {
    console.error('Error deleteRuta:', error);
    res.status(400).json({ error: error.message });
  }
};

const asignarRutas = async (req, res) => {
  const supabase = getSupabase();
  const cobradorid = req.body.cobradorid || req.body.cobrador_id;
  const rutaids = req.body.rutaids || req.body.ruta_ids;

  if (!cobradorid || !rutaids || rutaids.length === 0) {
    return res.status(400).json({ error: 'cobradorid y rutaids son requeridos' });
  }

  try {
    const { error: deleteError } = await supabase
      .from('cobrador_rutas')
      .delete()
      .eq('cobrador_id', cobradorid);

    if (deleteError) throw deleteError;

    const inserts = rutaids.map((rutaid) => ({
      cobrador_id: cobradorid,
      ruta_id: rutaid,
    }));

    const { error } = await supabase
      .from('cobrador_rutas')
      .insert(inserts);

    if (error) throw error;

    res.json({ message: 'Rutas asignadas correctamente' });
  } catch (error) {
    console.error('Error asignando rutas:', error.message);
    res.status(400).json({ error: error.message });
  }
};

const getRutasCobrador = async (req, res) => {
  const supabase = getSupabase();
  const cobradorid =
    req.params.cobradorid ||
    req.params.cobrador_id ||
    req.params.id;

  try {
    const { data: relaciones, error: relError } = await supabase
      .from('cobrador_rutas')
      .select('ruta_id')
      .eq('cobrador_id', cobradorid);

    if (relError) throw relError;

    const rutaIds = (relaciones ?? []).map((r) => r.ruta_id);

    if (rutaIds.length === 0) {
      return res.json([]);
    }

    const { data: rutas, error: rutasError } = await supabase
      .from('rutas')
      .select('id, nombre, descripcion')
      .in('id', rutaIds)
      .order('nombre', { ascending: true });

    if (rutasError) throw rutasError;

    return res.json(rutas ?? []);
  } catch (error) {
    console.error('Error getRutasCobrador:', error);
    return res.status(400).json({ error: error.message });
  }
};

const getResumenRuta = async (req, res) => {
  const supabase = getSupabase();
  const { id } = req.params;

  try {
    const { data: ruta, error: rutaError } = await supabase
      .from('rutas')
      .select('id, nombre')
      .eq('id', id)
      .single();

    if (rutaError) throw rutaError;

    const { data: clientes, error: clientesError } = await supabase
      .from('clientes')
      .select('id, nombre')
      .eq('ruta_id', id);

    if (clientesError) throw clientesError;

    let totalPrestamos = 0;
    let totalPagos = 0;
    let prestamosActivos = 0;

    if (clientes && clientes.length > 0) {
      const clienteIds = clientes.map((c) => c.id);

      const { data: prestamos, error: prestamosError } = await supabase
        .from('prestamos')
        .select('id, estado')
        .in('cliente_id', clienteIds);

      if (prestamosError) throw prestamosError;

      totalPrestamos = prestamos?.length ?? 0;
      prestamosActivos =
        prestamos?.filter((p) => p.estado === 'activo').length ?? 0;

      if (prestamos && prestamos.length > 0) {
        const prestamoIds = prestamos.map((p) => p.id);

        const { count, error: pagosError } = await supabase
          .from('pagos')
          .select('id', { count: 'exact', head: true })
          .in('prestamo_id', prestamoIds);

        if (pagosError) throw pagosError;

        totalPagos = count ?? 0;
      }
    }

    res.json({
      ruta: {
        id: ruta.id,
        nombre: ruta.nombre,
      },
      resumen: {
        clientes: clientes?.length ?? 0,
        prestamostotal: totalPrestamos,
        prestamosactivos: prestamosActivos,
        pagos: totalPagos,
      },
      advertencia:
        prestamosActivos > 0
          ? `Hay ${prestamosActivos} préstamos activos que se perderán`
          : null,
    });
  } catch (error) {
    console.error('Error getResumenRuta:', error.message);
    res.status(400).json({ error: error.message });
  }
};

module.exports = {
  getRutas,
  createRuta,
  updateRuta,
  deleteRuta,
  asignarRutas,
  getRutasCobrador,
  getResumenRuta,
};