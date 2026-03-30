// src/controllers/expenseController.js
const getSupabase = require('../config/supabaseClient');

// Registrar gasto (solo admin) con comprobante
const registerExpense = async (req, res) => {
    const supabase = getSupabase();
    const { tipo_gasto, valor, cobrador_id, comprobante_url } = req.body;
    const registrado_por = req.user.id;

    // Solo admin puede registrar
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo el administrador puede registrar gastos' });
    }

    const { error } = await supabase.from('gastos').insert([{
        cobrador_id: cobrador_id || registrado_por,
        tipo_gasto,
        valor,
        fecha: new Date().toISOString(),
        comprobante_url: comprobante_url || null,
        registrado_por,
        aprobado: true,
    }]);

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ message: 'Gasto registrado correctamente' });
};

// Obtener gastos - admin ve todos, cobrador solo los suyos
const getExpenses = async (req, res) => {
        const supabase = getSupabase();
    const usuarioId = req.user.id;
    const rol = req.user.rol;

    let query = supabase
        .from('gastos')
        .select(`
            *,
            usuarios!gastos_cobrador_id_fkey (nombre)
        `)
        .order('fecha', { ascending: false });

    // Cobrador solo ve los suyos
    if (rol !== 'admin') {
        query = query.eq('cobrador_id', usuarioId);
    }

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
};

// Subir comprobante a Supabase Storage
const uploadComprobante = async (req, res) => {
    const supabase = getSupabase();
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo el administrador puede subir comprobantes' });
    }

    const { fileName, fileBase64, mimeType } = req.body;

    try {
        // Convertir base64 a buffer
        const buffer = Buffer.from(fileBase64, 'base64');

        const { data, error } = await supabase.storage
            .from('comprobantes')
            .upload(`gastos/${Date.now()}_${fileName}`, buffer, {
                contentType: mimeType,
                upsert: false,
            });

        if (error) throw error;

        // Obtener URL pública
        const { data: urlData } = supabase.storage
            .from('comprobantes')
            .getPublicUrl(data.path);

        res.json({ url: urlData.publicUrl });
    } catch (error) {
        console.error('❌ Error subiendo comprobante:', error.message);
        res.status(400).json({ error: error.message });
    }
};

module.exports = { registerExpense, getExpenses, uploadComprobante };