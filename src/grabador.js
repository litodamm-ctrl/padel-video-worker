/* Graba una cámara RTSP sin parar, en segmentos de N segundos.
   El video se copia sin recodificar; si la cámara trae audio, se normaliza a
   AAC para que el MP4 final sea compatible. También regeneramos timestamps
   para evitar micro-pausas en los videos al unir segmentos. */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function crearGrabador({ id, rtsp, rtspFallback, carpeta, ffmpeg, segundosSegmento, log, spawnProcess = spawn, schedule = setTimeout, cancel = clearTimeout }) {
  let proceso = null, detenido = false, reinicios = 0, ultimoArranque = 0, reintento = null;
  let usarFallback = false, fallosPrimario = 0;
  fs.mkdirSync(carpeta, { recursive: true });

  function arrancar() {
    if (detenido || proceso) return;
    if (reintento) { cancel(reintento); reintento = null; }
    ultimoArranque = Date.now();
    const fuente = usarFallback && rtspFallback ? rtspFallback : rtsp;
    const patron = path.join(carpeta, "%Y%m%d-%H%M%S.ts");
    const args = [
      "-hide_banner", "-loglevel", "warning", "-nostats",
      "-rtsp_transport", "tcp",
      "-fflags", "+genpts+discardcorrupt",
      "-i", fuente,
      "-map", "0:v:0",
      "-map", "0:a?",
      "-c:v", "copy",
      "-c:a", "aac", "-b:a", "96k", "-ar", "48000",
      "-avoid_negative_ts", "make_zero",
      "-max_interleave_delta", "0",
      "-f", "segment",
      "-segment_time", String(segundosSegmento || 300),
      "-segment_atclocktime", "1",
      "-reset_timestamps", "1",
      "-strftime", "1",
      "-segment_format", "mpegts",
      patron,
    ];
    proceso = spawnProcess(ffmpeg || "ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    log.info(`[${id}] grabando ${usarFallback ? "(respaldo secundario)" : "(principal)"} → ${carpeta}`);
    let err = "";
    proceso.stderr.on("data", d => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    proceso.on("error", e => { log.error(`[${id}] no se pudo lanzar ffmpeg: ${e.message}`); });
    proceso.on("close", code => {
      proceso = null;
      if (detenido) return;
      const duracion = Date.now() - ultimoArranque;
      const ultimas = err.trim().split("\n").slice(-2).join(" | ");
      log.warn(`[${id}] ffmpeg terminó (código ${code})${ultimas ? ": " + ultimas : ""}`);

      if (!usarFallback && rtspFallback && rtspFallback !== rtsp) {
        fallosPrimario = duracion < 120000 ? fallosPrimario + 1 : 0;
        if (fallosPrimario >= 2) {
          usarFallback = true;
          reinicios = 0;
          fallosPrimario = 0;
          log.warn(`[${id}] principal inestable; usando stream secundario como respaldo para no perder grabación`);
        }
      } else if (usarFallback && duracion > 10 * 60 * 1000) {
        usarFallback = false;
        reinicios = 0;
        fallosPrimario = 0;
        log.info(`[${id}] reintentará el stream principal después de un periodo estable`);
      }
      programarReinicio();
    });
  }

  function programarReinicio() {
    if (detenido || reintento) return;
    // Si duró más de un minuto, reinicio inmediato; si cae en bucle, espera creciente hasta 60 s.
    reinicios = (Date.now() - ultimoArranque > 60000) ? 0 : reinicios + 1;
    const espera = Math.min(60000, 2000 * Math.pow(2, reinicios));
    log.info(`[${id}] reintento en ${Math.round(espera / 1000)} s`);
    reintento = schedule(() => { reintento = null; arrancar(); }, espera);
  }

  return {
    id, carpeta,
    iniciar: arrancar,
    detener() { detenido = true; if (reintento) { cancel(reintento); reintento = null; } if (proceso) { try { proceso.kill("SIGTERM"); } catch (_) {} } },
    reiniciar(motivo) {
      if (detenido) return;
      log.warn(`[${id}] reinicio preventivo${motivo ? ": " + motivo : ""}`);
      if (!usarFallback && rtspFallback && rtspFallback !== rtsp && /sin segmento/i.test(String(motivo || ""))) {
        usarFallback = true;
        reinicios = 0;
        fallosPrimario = 0;
        log.warn(`[${id}] sin datos en principal; cambia a stream secundario de respaldo`);
      }
      if (proceso) {
        try { proceso.kill("SIGTERM"); } catch (_) {}
      } else if (!reintento) {
        arrancar();
      }
    },
    grabando() { return !!proceso; },
    modo() { return usarFallback ? "secundario-respaldo" : "principal"; },
    ultimoArranque() { return ultimoArranque || null; },
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
