/* Procesa un pedido: busca la grabación, corta, sube y actualiza pedido:<codigo>.
   Todo lo que toca disco, ffmpeg o red entra por `deps` para poder probarlo. */
"use strict";
const path = require("path");
const { aLocal } = require("./cola.js");
const { seleccionar } = require("./segmentos.js");
const { claveDe } = require("./subida.js");

const MINIMO_SEG = 30;

async function procesarPedido(p, deps) {
  const { kv, log, ffmpeg, salidaDir, carpetaDe, listarSegmentos, cortar, subir, borrarLocal, alto } = deps;
  const key = "pedido:" + p.codigo;
  const base = Object.assign({}, p, { intentos: (p.intentos || 0) + 1, tsProceso: Date.now() });

  let cadena = Promise.resolve();
  function marcar(cambios) {
    Object.assign(base, cambios);
    const copia = Object.assign({}, base);
    cadena = cadena.then(() => kv.set(key, copia));
    return cadena;
  }
  async function fallar(msg) {
    await marcar({ estado: "error", error: msg, paso: null, avance: null });
    log.error(`[${p.codigo}] ${msg}`);
    return { ok: false, error: msg };
  }

  try {
    await marcar({ estado: "procesando", paso: "buscando grabación", avance: 5, error: null });
    const inicio = aLocal(p.fecha, p.startTime), fin = aLocal(p.fecha, p.endTime);
    if (!inicio || !fin || fin <= inicio) return fallar("La reserva no tiene fecha u horario válidos");

    const carpeta = carpetaDe(p.court);
    if (!carpeta) return fallar(`La cancha "${p.court}" no tiene cámara configurada en config.json`);

    const segs = await listarSegmentos(carpeta, inicio, fin, { ffmpeg });
    const sel = seleccionar(segs, inicio, fin);
    if (!sel || sel.duracion < MINIMO_SEG) return fallar(`No hay grabación de ${p.fecha} ${p.startTime}–${p.endTime} en ${carpeta}`);
    if (sel.parcial) log.warn(`[${p.codigo}] grabación incompleta: faltan ${sel.faltanteSeg} s`);

    await marcar({ paso: "armando el video", avance: 10, parcial: sel.parcial });
    const salida = path.join(salidaDir, p.codigo + ".mp4");
    let ultimo = 10;
    await cortar({
      archivos: sel.archivos, offset: sel.offset, duracion: sel.duracion, salida, ffmpeg, alto,
      onProgreso: pct => {
        const a = 10 + Math.round(pct * 0.7);
        if (a - ultimo >= 10) { ultimo = a; marcar({ avance: a }).catch(() => {}); }
      },
    });

    await marcar({ paso: "subiendo", avance: 85 });
    const clave = claveDe(p.codigo, p.fecha);
    const res = await subir(salida, clave, { nombreDescarga: p.codigo + ".mp4" });

    await marcar({
      estado: "listo", paso: null, avance: 100, error: null,
      url: res.url, key: res.key,
      duracion: sel.duracion, parcial: sel.parcial, faltanteSeg: sel.faltanteSeg,
      orientacionCorregida: true, marcaClub: true,
      tsListo: Date.now(),
    });
    try { borrarLocal(salida); } catch (_) {}
    log.info(`[${p.codigo}] listo · ${sel.duracion} s${sel.parcial ? " (parcial)" : ""} · ${res.url || res.key}`);
    return { ok: true, url: res.url, key: res.key };
  } catch (e) {
    return fallar(e && e.message ? e.message : String(e));
  }
}

module.exports = { procesarPedido };
