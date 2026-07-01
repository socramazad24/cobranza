const getSupabase = require('../config/supabaseClient');

const login = async (req, res) => {
  const supabase = getSupabase();
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: 'Email y contraseña son requeridos' });

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session)
      return res.status(401).json({ error: 'Credenciales inválidas' });

    const userId = data.user.id;
    const accessToken = data.session.access_token;

    const { data: usuarioData, error: usuarioError } = await supabase
      .from('usuarios')
      .select('rol, nombre')
      .eq('id', userId)
      .single();

    if (usuarioError)
      return res.status(400).json({ error: 'No se pudo obtener el rol del usuario' });

    return res.json({
      token: accessToken,
      rol: usuarioData.rol ?? 'cobrador',
      nombre: usuarioData.nombre ?? '',
      userId: userId,
    });
  } catch (err) {
    console.error('Error login:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

const createCobrador = async (req, res) => {
  const supabase = getSupabase();
  const { nombre, email, password, rutaids } = req.body;

  if (req.user?.rol !== 'admin')
    return res.status(403).json({ error: 'Solo el administrador puede crear cobradores' });

  if (!nombre || !email || !password)
    return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });

  try {
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (authError) throw authError;

    const newUserId = authData.user.id;

    const { error: insertError } = await supabase.from('usuarios').insert({
      id: newUserId,
      nombre,
      rol: 'cobrador',
    });
    if (insertError) throw insertError;

    if (Array.isArray(rutaids) && rutaids.length > 0) {
      const inserts = rutaids.map((rutaid) => ({
        cobrador_id: newUserId,
        ruta_id: rutaid,
      }));
      await supabase.from('cobrador_rutas').insert(inserts);
    }

    return res.status(201).json({ message: 'Cobrador creado correctamente', id: newUserId });
  } catch (err) {
    console.error('Error createCobrador:', err.message);
    return res.status(400).json({ error: err.message });
  }
};

const getCobradores = async (req, res) => {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, nombre')
      .eq('rol', 'cobrador')
      .order('nombre');
    if (error) throw error;
    return res.json(data ?? []);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
};

module.exports = { login, createCobrador, getCobradores };