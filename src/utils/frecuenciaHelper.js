// src/utils/frecuenciaHelper.js

const FRECUENCIAS = {
  diario: {
    label: 'Diario',
    dias: 1,
    pagosPorPlazo: (dias) => dias,
  },
  semanal: {
    label: 'Semanal',
    dias: 7,
    pagosPorPlazo: (dias) => Math.ceil(dias / 7),
  },
  quincenal: {
    label: 'Quincenal',
    dias: 15,
    pagosPorPlazo: (dias) => Math.ceil(dias / 15),
  },
  mensual: {
    label: 'Mensual',
    dias: 30,
    pagosPorPlazo: (dias) => Math.ceil(dias / 30),
  },
};

function calcularCuota(montoTotal, diasPlazo, frecuencia = 'diario') {
  const cfg = FRECUENCIAS[frecuencia];
  if (!cfg) throw new Error(`Frecuencia inválida: ${frecuencia}`);
  const numPagos = cfg.pagosPorPlazo(diasPlazo);
  return Number((montoTotal / numPagos).toFixed(2));
}

function generarFechasPago(fechaInicio, frecuencia, diasPlazo) {
  const cfg = FRECUENCIAS[frecuencia];
  if (!cfg) throw new Error(`Frecuencia inválida: ${frecuencia}`);
  const numPagos = cfg.pagosPorPlazo(diasPlazo);
  const fechas = [];
  for (let i = 0; i < numPagos; i++) {
    const f = new Date(fechaInicio);
    f.setDate(f.getDate() + cfg.dias * (i + 1));
    fechas.push(f);
  }
  return fechas;
}

function getInfoFrecuencia(frecuencia) {
  return FRECUENCIAS[frecuencia] || FRECUENCIAS.diario;
}

module.exports = {
  FRECUENCIAS,
  calcularCuota,
  generarFechasPago,
  getInfoFrecuencia,
};
