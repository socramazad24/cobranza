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

// Eliminar ruta
const deleteRuta = async (req, res) => {
    const supabase = getSupabase();
    const { id } = req.params;

    const { error } = await supabase
        .from('rutas')
        .delete()
        .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Ruta eliminada correctamente' });
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



module.exports = { getRutas, createRuta, updateRuta, deleteRuta, asignarRutas, getRutasCobrador };