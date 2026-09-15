"use strict";
const fs = require("fs");
const path = require("path");
const { claveCorteDe } = require("./subida.js");

async function procesarCorte(key, c, deps) {
  const { kv, log, ffmpeg, salidaDir, descargar, cortarClip, subir } = deps;
  const base = Object.assign({}, c, { intentos: (c.intentos || 0) + 1, tsProceso: Date.now() });
  async function marcar(cambios) {
    Object.assign(base, cambios);
    await kv.set(key, Object.assign({}, base));
  }
  try {
    if (!base.codigo || !base.videoKey) throw new Error("Faltan datos del video original");
    const inicio = Math.max(0, Number(base.inicioSeg) || 0);
    const fin = Number(base.finSeg) || 0;
    const dur = fin - inicio;
    if (!(dur >= 2 && dur <= 120)) throw new Error("El corte debe durar entre 2 y 120 segundos");

    await marcar({ estado: "procesando", paso: "descargando", avance: 10, error: null });
    const original = path.join(salidaDir, "src-" + base.codigo + ".mp4");
    const salida = path.join(salidaDir, "clip-" + base.codigo + "-" + base.id + ".mp4");
    await descargar(base.videoKey, original);

    await marcar({ paso: "cortando", avance: 30 });
    await cortarClip({
      entrada: original, inicioSeg: inicio, duracion: dur, salida, ffmpeg,
      normalizado: !!base.normalizado,
      onProgreso: pct => {
        const a = 30 + Math.round(pct * 0.5);
        if (a % 10 === 0) marcar({ avance: a }).catch(() => {});
      },
    });

    await marcar({ paso: "subiendo", avance: 85 });
    const r2key = claveCorteDe(base.codigo, base.fecha, base.id);
    const res = await subir(salida, r2key, { nombreDescarga: base.codigo + "-clip.mp4" });
    await marcar({ estado: "listo", paso: null, avance: 100, url: res.url, key: res.key, tsListo: Date.now() });

    try { fs.unlinkSync(original); } catch (_) {}
    try { fs.unlinkSync(salida); } catch (_) {}
    log.info(`[${base.codigo}] clip ${inicio.toFixed(1)}-${fin.toFixed(1)} s listo`);
    return { ok: true };
  } catch (e) {
    await marcar({ estado: "error", paso: null, avance: null, error: e.message || String(e) });
    log.error(`[clip ${base.codigo || "?"}] ${e.message || e}`);
    return { ok: false, error: e.message || String(e) };
  }
}

module.exports = { procesarCorte };
