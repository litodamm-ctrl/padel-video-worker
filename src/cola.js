/* Qué pedidos toca procesar ahora. Lógica pura. */
"use strict";

const MAX_INTENTOS = 3;
const PROCESANDO_CADUCA_MS = 2 * 3600 * 1000; // un "procesando" abandonado (PC apagada a mitad) se reintenta

/* 'AAAA-MM-DD' + 'HH:MM' → Date en hora local de la PC (que debe estar en Bogotá). */
function aLocal(fecha, hora) {
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fecha || ""));
  const m2 = /^(\d{2}):(\d{2})$/.exec(String(hora || ""));
  if (!m1 || !m2) return null;
  return new Date(+m1[1], +m1[2] - 1, +m1[3], +m2[1], +m2[2], 0);
}

function procesable(p, ahora) {
  if (p.estado === "programado" || p.estado === "pendiente") return true;
  if (p.estado === "error") return (p.intentos || 0) < MAX_INTENTOS;
  if (p.estado === "procesando") return !!p.tsProceso && (ahora.getTime() - p.tsProceso) > PROCESANDO_CADUCA_MS;
  return false;
}

/* pedidos: [{ codigo, estado, fecha, startTime, endTime, intentos, tsProceso }]
   Devuelve los que ya terminaron hace más de `margenMin`, del más viejo al más nuevo. */
function pendientes(pedidos, ahora, margenMin) {
  const limite = ahora.getTime() - (margenMin || 0) * 60000;
  return pedidos
    .filter(p => p && procesable(p, ahora))
    .map(p => ({ p, fin: aLocal(p.fecha, p.endTime) }))
    .filter(x => x.fin && x.fin.getTime() <= limite)
    .sort((a, b) => a.fin - b.fin)
    .map(x => x.p);
}

/* Une el pedido con los datos de la reserva (video:<codigo>) por si el pedido
   viene sin horario (pedidos creados por versiones viejas de la app). */
function aRegistro(codigo, pedido, reserva) {
  const r = reserva || {};
  const base = {
    codigo,
    fecha: r.fecha || r.date || null,
    court: r.court || r.cancha || null,
    startTime: r.startTime || r.inicio || null,
    endTime: r.endTime || r.fin || null,
    bookingType: r.bookingType || null,
    groupId: r.groupId || null,
  };
  const out = Object.assign(base, pedido || {});
  for (const k of ["fecha", "court", "startTime", "endTime"]) if (!out[k] && base[k]) out[k] = base[k];
  out.codigo = codigo;
  return out;
}

module.exports = { aLocal, pendientes, aRegistro, MAX_INTENTOS };
