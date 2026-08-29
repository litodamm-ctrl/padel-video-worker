/* Graba una cámara RTSP sin parar, en segmentos de N segundos, copiando el
   stream tal cual (sin recodificar: casi no usa CPU). Si ffmpeg se cae o la
   cámara se desconecta, espera y vuelve a arrancar. */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function crearGrabador({ id, rtsp, carpeta, ffmpeg, segundosSegmento, log }) {
  let proceso = null, detenido = false, reinicios = 0, ultimoArranque = 0;
  fs.mkdirSync(carpeta, { recursive: true });

  function arrancar() {
    if (detenido) return;
    ultimoArranque = Date.now();
    const patron = path.join(carpeta, "%Y%m%d-%H%M%S.mp4");
    const args = [
      "-hide_banner", "-loglevel", "warning", "-nostats",
      "-rtsp_transport", "tcp",
      "-use_wallclock_as_timestamps", "1",
      "-i", rtsp,
      "-c", "copy",
      "-f", "segment",
      "-segment_time", String(segundosSegmento || 300),
      "-segment_atclocktime", "1",
      "-reset_timestamps", "1",
      "-strftime", "1",
      "-segment_format", "mp4",
      "-segment_format_options", "movflags=+frag_keyframe+empty_moov+default_base_moof",
      patron,
    ];
    proceso = spawn(ffmpeg || "ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    log.info(`[${id}] grabando → ${carpeta}`);
    let err = "";
    proceso.stderr.on("data", d => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    proceso.on("error", e => { log.error(`[${id}] no se pudo lanzar ffmpeg: ${e.message}`); programarReinicio(); });
    proceso.on("close", code => {
      proceso = null;
      if (detenido) return;
      const ultimas = err.trim().split("\n").slice(-2).join(" | ");
      log.warn(`[${id}] ffmpeg terminó (código ${code})${ultimas ? ": " + ultimas : ""}`);
      programarReinicio();
    });
  }

  function programarReinicio() {
    if (detenido) return;
    // Si duró más de un minuto, reinicio inmediato; si cae en bucle, espera creciente hasta 60 s.
    reinicios = (Date.now() - ultimoArranque > 60000) ? 0 : reinicios + 1;
    const espera = Math.min(60000, 2000 * Math.pow(2, reinicios));
    log.info(`[${id}] reintento en ${Math.round(espera / 1000)} s`);
    setTimeout(arrancar, espera);
  }

  return {
    id, carpeta,
    iniciar: arrancar,
    detener() { detenido = true; if (proceso) { try { proceso.kill("SIGTERM"); } catch (_) {} } },
    grabando() { return !!proceso; },
  };
}

/* Borra segmentos más viejos que `horas` en la carpeta. Devuelve cuántos borró. */
function limpiarAntiguos(carpeta, horas) {
  let n = 0;
  const limite = Date.now() - horas * 3600 * 1000;
  let nombres = [];
  try { nombres = fs.readdirSync(carpeta); } catch (_) { return 0; }
  for (const nombre of nombres) {
    if (!/\.(mp4|mkv|ts)$/i.test(nombre)) continue;
    const ruta = path.join(carpeta, nombre);
    try {
      const st = fs.statSync(ruta);
      if (st.mtimeMs < limite) { fs.unlinkSync(ruta); n++; }
    } catch (_) {}
  }
  return n;
}

module.exports = { crearGrabador, limpiarAntiguos };
