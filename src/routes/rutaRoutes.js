const express = require('express');
const router = express.Router();
const supabase = require('../config/supabaseClient');
const { verifyToken } = require('../middlewares/authMiddleware');

router.get('/', verifyToken, async (req, res) => {
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

// ✅ Agrega esta ruta
router.get('/cobrador/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('cobrador_rutas')
      .select('rutas(id, nombre)')
      .eq('cobrador_id', id);

    if (error) throw error;

    const rutas = data.map(cr => cr.rutas);
    res.json(rutas);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ✅ Actualizar rutas de un cobrador (admin)
router.put('/cobrador/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.rol !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { id } = req.params;
    const { rutas_ids } = req.body;

    if (!rutas_ids?.length) {
      return res.status(400).json({ error: 'Selecciona al menos una ruta' });
    }

    // 1. Eliminar rutas actuales del cobrador
    const { error: deleteError } = await supabase
      .from('cobrador_rutas')
      .delete()
      .eq('cobrador_id', id);

    if (deleteError) throw deleteError;

    // 2. Insertar las nuevas rutas seleccionadas
    const nuevasRutas = rutas_ids.map((ruta_id) => ({
      cobrador_id: id,
      ruta_id,
    }));

    const { error: insertError } = await supabase
      .from('cobrador_rutas')
      .insert(nuevasRutas);

    if (insertError) throw insertError;

    res.json({ message: 'Rutas actualizadas correctamente' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;