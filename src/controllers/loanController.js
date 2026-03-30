const getSupabase = require('../config/supabaseClient');

const createLoan = async (req, res) => {
    const supabase = getSupabase();
    const {
        cliente_nombre,
        cliente_telefono,
        cliente_direccion,
        monto_prestado,
        dias_plazo,
        cobrador_id,   // El admin selecciona qué cobrador
        ruta_nombre    // Nombre de la ruta (si no existe, se crea)
    } = req.body;

    // El cobrador_id viene del token si es cobrador, del body si es admin
    const responsable_id = req.user.rol === 'admin' ? cobrador_id : req.user.id;

    if (dias_plazo < 7 || dias_plazo > 60) {
        return res.status(400).json({ error: 'El plazo debe ser entre 7 y 60 días' });
    }

    try {
        // 1. Buscar o crear la ruta
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
                // Crear nueva ruta automáticamente
                const { data: nuevaRuta, error: rutaError } = await supabase
                    .from('rutas')
                    .insert([{ nombre: ruta_nombre }])
                    .select()
                    .single();

                if (rutaError) throw rutaError;
                rutaId = nuevaRuta.id;

                // Asignar la nueva ruta al cobrador automáticamente
                await supabase.from('cobrador_rutas').insert([{
                    cobrador_id: responsable_id,
                    ruta_id: rutaId
                }]);
            }
        }

        // 2. Crear el cliente con toda su info
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

        // 3. Calcular montos con el 20%
        const monto_total = monto_prestado * 1.20;
        const cuota_diaria = monto_total / dias_plazo;

        const fecha_inicio = new Date();
        const fecha_fin = new Date();
        fecha_fin.setDate(fecha_inicio.getDate() + dias_plazo);

        // 4. Crear el préstamo
        const { error: prestamoError } = await supabase
            .from('prestamos')
            .insert([{
                cliente_id: clienteData.id,
                cobrador_id: responsable_id,
                monto_prestado,
                monto_total,
                saldo_pendiente: monto_total,
                cuota_diaria,
                fecha_inicio: fecha_inicio.toISOString(),
                fecha_fin: fecha_fin.toISOString(),
                estado: 'activo'
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
    // Clientes que tienen un préstamo activo pero no han pagado en más de 2 días
    const { data, error } = await supabase.rpc('obtener_clientes_morosos'); // Requiere crear una función en SQL en Supabase
    
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
};

module.exports = { createLoan, getClavos };