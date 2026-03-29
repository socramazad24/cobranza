// src/controllers/adminController.js
const supabase = require('../config/supabaseClient');

// ── GET ALL USERS ─────────────────────────────────────────────
const getAllUsers = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, nombre, rol')
      .order('nombre', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ── UPDATE USER ───────────────────────────────────────────────
const updateUser = async (req, res) => {
  const { id } = req.params;
  const { nombre, rol } = req.body;

  const { error } = await supabase
    .from('usuarios')
    .update({ nombre, rol })
    .eq('id', id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Usuario actualizado correctamente' });
};

// ── DELETE USER ───────────────────────────────────────────────
const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Borrar rutas asignadas al cobrador
    const { error: rutasError } = await supabase
      .from('cobrador_rutas')
      .delete()
      .eq('cobrador_id', id);
    if (rutasError) throw rutasError;

    // 2. Borrar de tabla usuarios
    const { error: userError } = await supabase
      .from('usuarios')
      .delete()
      .eq('id', id);
    if (userError) throw userError;

    // 3. Borrar de Supabase Auth
    const { error: authError } = await supabase.auth.admin.deleteUser(id);
    if (authError) throw authError;

    res.json({ message: 'Usuario eliminado correctamente' });
  } catch (error) {
    console.error('❌ Error deleteUser:', error.message);
    res.status(400).json({ error: error.message });
  }
};

module.exports = { getAllUsers, updateUser, deleteUser };