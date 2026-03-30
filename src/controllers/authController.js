// src/controllers/authController.js
const getSupabase = require('../config/supabaseClient');

// ── LOGIN ─────────────────────────────────────────────────────
const login = async (req, res) => {
    const supabase = getSupabase();
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) return res.status(400).json({ error: error.message });

  const { data: usuarioData, error: usuarioError } = await supabase
    .from('usuarios')
    .select('rol, nombre')
    .eq('id', data.user.id)
    .single();

  if (usuarioError)
    return res.status(400).json({ error: usuarioError.message });

  res.json({
    user:   data.user,
    token:  data.session.access_token,
    rol:    usuarioData.rol,
    nombre: usuarioData.nombre,
    id:     data.user.id,   // ✅ Agregado
  });
};

// ── CREAR COBRADOR ────────────────────────────────────────────
const createCobrador = async (req, res) => {
    const supabase = getSupabase();
  const { nombre, email, password, rutas_ids } = req.body;

  if (!nombre || !email || !password || !rutas_ids?.length) {
    return res
      .status(400)
      .json({ error: 'Todos los campos son requeridos' });
  }

  try {
    // 1. Crear usuario en Supabase Auth
    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (authError) throw authError;

    const userId = authData.user.id;

    // 2. Insertar en tabla usuarios
    const { error: userError } = await supabase
      .from('usuarios')
      .insert({ id: userId, nombre, rol: 'cobrador' });

    if (userError) throw userError;

    // 3. Insertar múltiples rutas en cobrador_rutas
    const rutasInsert = rutas_ids.map((ruta_id) => ({
      cobrador_id: userId,
      ruta_id,
    }));

    const { error: rutasError } = await supabase
      .from('cobrador_rutas')
      .insert(rutasInsert);

    if (rutasError) throw rutasError;

    res.status(201).json({ message: 'Cobrador creado correctamente' });
  } catch (error) {
    console.error('Error createCobrador:', error);
    res.status(400).json({ error: error.message });
  }
};

// ── GET COBRADORES ────────────────────────────────────────────
const getCobradores = async (req, res) => {
    const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select(`
        id, nombre, ruta_id,
        cobrador_rutas (
          rutas ( id, nombre )
        )
      `)
      .eq('rol', 'cobrador');

    if (error) throw error;

    const cobradores = data.map((c) => ({
      ...c,
      rutas: c.cobrador_rutas?.map((cr) => cr.rutas) ?? [],
    }));

    res.json(cobradores);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports = { login, createCobrador, getCobradores };