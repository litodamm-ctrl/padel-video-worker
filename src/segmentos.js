/* Selección de segmentos grabados para cubrir el horario de una reserva.
   Lógica pura (sin disco ni ffmpeg) para poder probarla sola. */
"use strict";
const path = require("path");

const RE_NOMBRE = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.(mp4|mkv|ts)$/i;

/* "20260828-153000.mp4" → Date local 28/08/2026 15:30:00 (o null). */
function parsearNombre(ruta) {
  const m = path.basename(String(ruta || "")).match(RE_NOMBRE);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/* segmentos: [{ ruta, inicio: Date, duracion: segundos }]
   Devuelve qué archivos concatenar, desde qué segundo del primero empezar,
   cuántos segundos de material hay dentro del rango y si falta algo. */
function seleccionar(segmentos, inicio, fin, opts) {
  const tol = (opts && opts.toleranciaSeg) || 5;
  const ini = inicio.getTime() / 1000, f = fin.getTime() / 1000;
  const orden = segmentos.slice().sort((a, b) => a.inicio - b.inicio);
  const sel = orden.filter(s => {
    const si = s.inicio.getTime() / 1000, sf = si + s.duracion;
    return sf > ini && si < f;
  });
  if (!sel.length) return null;

  const pIni = sel[0].inicio.getTime() / 1000;
  const uFin = sel[sel.length - 1].inicio.getTime() / 1000 + sel[sel.length - 1].duracion;

  let duracion = 0, faltante = 0, parcial = false;
  for (let i = 0; i < sel.length; i++) {
    const si = sel[i].inicio.getTime() / 1000, sf = si + sel[i].duracion;
    duracion += Math.max(0, Math.min(sf, f) - Math.max(si, ini));
    if (i > 0) {
      const gap = si - (sel[i - 1].inicio.getTime() / 1000 + sel[i - 1].duracion);
      if (gap > tol) { faltante += gap; parcial = true; }
    }
  }
  if (pIni - ini > tol) { faltante += pIni - ini; parcial = true; }
  if (f - uFin > tol) { faltante += f - uFin; parcial = true; }

  return {
    archivos: sel.map(s => s.ruta),
    offset: Math.round(Math.max(0, ini - pIni)),
    duracion: Math.round(duracion),
    parcial,
    faltanteSeg: Math.round(faltante),
  };
}

module.exports = { parsearNombre, seleccionar, RE_NOMBRE };
