// src/middlewares/authMiddleware.js
const getSupabase = require('../config/supabaseClient');

const verifyToken = async (req, res, next) => {
  const supabase = getSupabase();

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.error('❌ Supabase getUser error:', error?.message || 'Usuario no encontrado');
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }

    const { data: usuarioData, error: usuarioError } = await supabase
      .from('usuarios')
      .select('rol, nombre')
      .eq('id', user.id)
      .single();

    if (usuarioError) {
      console.error('❌ Error consultando tabla usuarios:', usuarioError.message);
      return res.status(500).json({ error: 'No se pudo obtener la información del usuario' });
    }

    req.user = {
      id: user.id,
      email: user.email,
      rol: usuarioData?.rol || 'cobrador',
      nombre: usuarioData?.nombre || '',
    };

    return next();
  } catch (err) {
    console.error('❌ verifyToken catch:', err.message);
    return res.status(500).json({ error: 'Error interno validando token' });
  }
};

module.exports = { verifyToken };