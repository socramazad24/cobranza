// controllers/loanController.js
const getSupabase = require('../config/supabaseClient');

const createLoan = async (req, res) => {
    const supabase = getSupabase();
    const {
        cliente_nombre,
        cliente_telefono,
        cliente_direccion,
        monto_prestado,
        dias_plazo,
        cobrador_id,
        ruta_nombre
    } = req.body;

    const responsable_id = req.user.rol === 'admin' ? cobrador_id : req.user.id;

    if (dias_plazo < 7 || dias_plazo > 60) {
        return res.status(400).json({ error: 'El plazo debe ser entre 7 y 60 días' });
    }

    try {
        let rutaId = null;
        if (ruta_nombre) {
            const { data: rutaExistente } = await supabase
                .from('rutas')
                .select('id')
                .ilike('nombre', ruta_nombre)
                .single();

            if (rutaExistente) {
                rutaId = rutaExistente.id;
            } else {
                const { data: nuevaRuta, error: rutaError } = await supabase
                    .from('rutas')
                    .insert([{ nombre: ruta_nombre }])
                    .select()
                    .single();

                if (rutaError) throw rutaError;
                rutaId = nuevaRuta.id;

                await supabase.from('cobrador_rutas').insert([{
                    cobrador_id: responsable_id,
                    ruta_id: rutaId
                }]);
            }
        }

        const { data: clienteData, error: clienteError } = await supabase
            .from('clientes')
            .insert([{
                nombre: cliente_nombre,
                telefono: cliente_telefono || null,
                direccion: cliente_direccion || null,
                cobrador_id: responsable_id,
                ruta_id: rutaId
            }])
            .select()
            .single();

        if (clienteError) throw clienteError;

        const monto_total   = monto_prestado * 1.20;
        const cuota_diaria  = monto_total / dias_plazo;
        const fecha_inicio  = new Date();
        const fecha_fin     = new Date();
        fecha_fin.setDate(fecha_inicio.getDate() + dias_plazo);

        const { error: prestamoError } = await supabase
            .from('prestamos')
            .insert([{
                cliente_id:      clienteData.id,
                cobrador_id:     responsable_id,
                monto_prestado,
                monto_total,
                saldo_pendiente: monto_total,
                cuota_diaria,
                fecha_inicio:    fecha_inicio.toISOString(),
                fecha_fin:       fecha_fin.toISOString(),
                estado:          'activo'
            }]);

        if (prestamoError) throw prestamoError;

        res.status(201).json({ message: 'Préstamo creado exitosamente' });
    } catch (error) {
        console.error('❌ Error creando préstamo:', error.message);
        res.status(400).json({ error: error.message });
    }
};

const getClavos = async (req, res) => {
    const supabase = getSupabase();

    try {
        const rol         = req.user.rol;
        const cobrador_id = rol === 'admin' ? null : req.user.id;

        console.log(`🔍 getClavos → rol: ${rol}, cobrador_id: ${cobrador_id}`);

        // ✅ Siempre llama la versión CON parámetro explícito
        // null = admin ve todos | uuid = cobrador ve solo los suyos
        const { data, error } = await supabase.rpc('obtener_clientes_morosos', {
            p_cobrador_id: cobrador_id
        });

        if (error) {
            console.error('❌ getClavos RPC error:', error.message);
            return res.status(400).json({ error: error.message });
        }

        console.log(`✅ getClavos → ${data?.length ?? 0} clavos encontrados`);
        return res.json(data ?? []);

    } catch (err) {
        console.error('❌ getClavos exception:', err.message);
        return res.status(500).json({ error: err.message });
    }
};

module.exports = { createLoan, getClavos };