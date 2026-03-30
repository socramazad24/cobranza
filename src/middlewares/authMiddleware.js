// src/middlewares/authMiddleware.js
const getSupabase = require('../config/supabaseClient');

const verifyToken = async (req, res, next) => {
    const supabase = getSupabase();
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Token requerido' });

    try {
        // Verificamos el token con Supabase
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) return res.status(403).json({ error: 'Token inválido' });

        // ✅ Traemos el rol desde la tabla pública
        const { data: usuarioData } = await supabase
            .from('usuarios')
            .select('rol, nombre')
            .eq('id', user.id)
            .single();

        req.user = {
            id: user.id,
            email: user.email,
            rol: usuarioData?.rol || 'cobrador',  // ✅ Agregamos el rol al request
            nombre: usuarioData?.nombre
        };

        next();
    } catch (err) {
        return res.status(403).json({ error: 'Token inválido' });
    }
};

module.exports = { verifyToken };