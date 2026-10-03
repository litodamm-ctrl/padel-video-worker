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
  const orden = segmentos
    .map(s => {
      const si = s.inicio.getTime() / 1000;
      return Object.assign({}, s, { _si: si, _sf: si + Number(s.duracion || 0) });
    })
    .filter(s => s._sf > ini && s._si < f && s._sf > s._si)
    .sort((a, b) => a._si - b._si || b._sf - a._sf);

  if (!orden.length) return null;

  // Cubre la línea de tiempo una sola vez. Si dos segmentos se solapan por un
  // reinicio/failover de ffmpeg, el segundo se recorta con inpoint para no
  // repetir minutos ni generar un MP4 más largo que la reserva.
  const tramos = [];
  let cursor = ini;
  let faltante = 0;
  const usados = new Set();

  while (cursor < f - 0.01) {
    let mejor = null, mejorIdx = -1;
    for (let i = 0; i < orden.length; i++) {
      if (usados.has(i)) continue;
      const x = orden[i];
      if (x._sf <= cursor + 0.01) continue;
      if (x._si <= cursor + tol) {
        if (!mejor || x._sf > mejor._sf) { mejor = x; mejorIdx = i; }
      }
    }

    if (!mejor) {
      let siguiente = null;
      for (let i = 0; i < orden.length; i++) {
        if (usados.has(i)) continue;
        const x = orden[i];
        if (x._sf <= cursor + 0.01) continue;
        if (!siguiente || x._si < siguiente._si) siguiente = x;
      }
      if (!siguiente) {
        const resto = f - cursor;
        if (resto > tol) faltante += resto;
        break;
      }
      const gap = Math.max(0, Math.min(f, siguiente._si) - cursor);
      if (gap > tol) faltante += gap;
      cursor = Math.max(cursor, siguiente._si);
      continue;
    }

    usados.add(mejorIdx);
    const desde = Math.max(cursor, mejor._si, ini);
    const hasta = Math.min(mejor._sf, f);
    if (hasta <= desde + 0.01) continue;

    tramos.push({
      ruta: mejor.ruta,
      inpoint: Math.max(0, desde - mejor._si),
      outpoint: Math.max(0, hasta - mejor._si),
      duracion: hasta - desde,
      inicio: mejor.inicio,
    });
    cursor = hasta;
  }

  if (!tramos.length) return null;
  const duracion = tramos.reduce((n, t) => n + t.duracion, 0);
  const parcial = faltante > 0;

  return {
    archivos: tramos.map(t => t.ruta),
    tramos,
    offset: Math.round(tramos[0].inpoint || 0),
    duracion: Math.round(duracion),
    parcial,
    faltanteSeg: Math.round(faltante),
  };
}

module.exports = { parsearNombre, seleccionar, RE_NOMBRE };
