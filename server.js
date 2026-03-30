// Solo carga dotenv si NO estás en producción
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}const express = require('express');
const cors = require('cors');

const authRoutes = require('./src/routes/authRoutes');
const loanRoutes = require('./src/routes/loanRoutes');
const expenseRoutes = require('./src/routes/expenseRoutes');
const reportRoutes = require('./src/routes/reportRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const rutaRoutes = require('./src/routes/rutaRoutes');
const observacionRoutes = require('./src/routes/observacionRoutes');


const app = express();

app.use(cors());
app.use(express.json());

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/payments', paymentRoutes);
// Añade en server.js junto a las otras rutas
app.use('/api/admin', adminRoutes);
app.use('/api/rutas', rutaRoutes);
app.use('/api/observaciones', observacionRoutes);
app.use('/api/clients', require('./src/routes/clientsRoutes'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});

