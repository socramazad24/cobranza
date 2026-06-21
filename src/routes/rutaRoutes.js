const express = require('express');
const router = express.Router();
const getSupabase = require('../config/supabaseClient');
const {
  createRuta,
  updateRuta,
  deleteRuta
} = require('../controllers/rutaController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.get('/', verifyToken, async (req, res) => {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from('rutas')
      .select('id, nombre, descripcion')
      .order('nombre');
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/cobrador/:id', verifyToken, async (req, res) => {
  const supabase = getSupabase();
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('cobrador_rutas')
      .select('rutas(id, nombre)')
      .eq('cobrador_id', id);
    if (error) throw error;
    res.json(data.map(cr => cr.rutas));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/cobrador/:id', verifyToken, async (req, res) => {
  const supabase = getSupabase();
  try {
    if (req.user.rol !== 'admin')
      return res.status(403).json({ error: 'Acceso denegado' });
    const { id } = req.params;
    const { rutas_ids } = req.body;
    if (!rutas_ids?.length)
      return res.status(400).json({ error: 'Selecciona al menos una ruta' });
    const { error: deleteError } = await supabase
      .from('cobrador_rutas').delete().eq('cobrador_id', id);
    if (deleteError) throw deleteError;
    const { error: insertError } = await supabase
      .from('cobrador_rutas').insert(rutas_ids.map(ruta_id => ({ cobrador_id: id, ruta_id })));
    if (insertError) throw insertError;
    res.json({ message: 'Rutas actualizadas correctamente' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ✅ Las 3 que faltaban
router.post('/',    verifyToken, createRuta);   // POST   /api/rutas
router.put('/:id',  verifyToken, updateRuta);   // PUT    /api/rutas/:id
router.delete('/:id', verifyToken, deleteRuta); // DELETE /api/rutas/:id

module.exports = router;