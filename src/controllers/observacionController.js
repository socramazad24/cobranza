// src/controllers/observacionController.js
const getSupabase = require('../config/supabaseClient');

// Crear una observación
const createObservacion = async (req, res) => {
    const supabase = getSupabase();
    const { tipo, referencia_id, descripcion } = req.body;
    const cobrador_id = req.user.id;

    if (!tipo || !referencia_id || !descripcion) {
        return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    const { error } = await supabase.from('observaciones').insert([{
        tipo,
        referencia_id,
        cobrador_id,
        descripcion,
    }]);

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ message: 'Observación registrada correctamente' });
};

// Listar observaciones - SIN JOIN de Supabase, consulta manual
const getObservaciones = async (req, res) => {
    const supabase = getSupabase();
    const { resuelta } = req.query;

    try {
        // 1. Traemos las observaciones + cobrador
        let query = supabase
            .from('observaciones')
            .select(`
                *,
                usuarios!observaciones_cobrador_id_fkey (nombre)
            `)
            .order('created_at', { ascending: false });

        if (resuelta !== undefined) {
            query = query.eq('resuelta', resuelta === 'true');
        }

        const { data: observaciones, error } = await query;
        if (error) throw error;

        // 2. Para cada observación buscamos el préstamo y cliente manualmente
        const enriched = await Promise.all(
            observaciones.map(async (obs) => {
                if (obs.tipo === 'prestamo' && obs.referencia_id) {
                    const { data: prestamo } = await supabase
                        .from('prestamos')
                        .select(`
                            id,
                            monto_prestado,
                            clientes (nombre, telefono)
                        `)
                        .eq('id', obs.referencia_id)
                        .single();

                    return { ...obs, prestamo_data: prestamo || null };
                }
                return { ...obs, prestamo_data: null };
            })
        );

        console.log('📋 Primera observación:', JSON.stringify(enriched[0], null, 2));
        res.json(enriched);
    } catch (error) {
        console.error('❌ Error getObservaciones:', error.message);
        res.status(400).json({ error: error.message });
    }
};

// Resolver observación
const resolverObservacion = async (req, res) => {
    const supabase = getSupabase();
    const { id } = req.params;
    const admin_id = req.user.id;

    const { error } = await supabase
        .from('observaciones')
        .update({ resuelta: true, resuelta_por: admin_id })
        .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Observación resuelta' });
};

module.exports = { createObservacion, getObservaciones, resolverObservacion };