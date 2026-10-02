"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function rtspSecundario(cam) {
  if (cam.liveRtsp) return cam.liveRtsp;
  const raw = String(cam.rtsp || "");
  if (/subtype=0\b/i.test(raw)) return raw.replace(/subtype=0\b/i, "subtype=1");
  return raw;
}

function crearPublicadorLive({ cam, ffmpeg, carpeta, subir, log, prefijo }) {
  let proceso = null;
  let detenido = false;
  let timer = null;
  let subiendo = false;
  let reinicios = 0;
  let reintento = null;
  const vistos = new Map();

  fs.mkdirSync(carpeta, { recursive: true });

  function lanzar() {
    if (detenido || proceso) return;
    if (reintento) { clearTimeout(reintento); reintento = null; }
    const entrada = rtspSecundario(cam);
    const playlist = "index.m3u8";
    const segmentos = "seg-%06d.m4s";

    // Un reinicio nunca debe mezclar segmentos de codecs distintos en el mismo
    // playlist. Limpiamos solo los archivos temporales del live.
    try {
      for (const n of fs.readdirSync(carpeta)) {
        if (n === "index.m3u8" || n === "init.mp4" || /^seg-\d+\.m4s$/i.test(n)) {
          try { fs.unlinkSync(path.join(carpeta, n)); } catch (_) {}
        }
      }
      vistos.clear();
    } catch (_) {}

    const args = [
      "-hide_banner", "-loglevel", "warning", "-nostats",
      "-rtsp_transport", "tcp",
      "-fflags", "+genpts+discardcorrupt",
      "-i", entrada,
      "-map", "0:v:0", "-map", "0:a?",
      // El stream secundario se recodifica a H.264 Baseline + AAC. Así Chrome,
      // Safari, Edge y móviles pueden reproducirlo aunque la cámara entregue
      // H.265 o un perfil H.264 no compatible con Media Source Extensions.
      "-vf", "fps=15",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-tune", "zerolatency",
      "-profile:v", "baseline",
      "-level:v", "3.1",
      "-pix_fmt", "yuv420p",
      "-b:v", "900k",
      "-maxrate", "1100k",
      "-bufsize", "1800k",
      "-g", "30",
      "-keyint_min", "30",
      "-sc_threshold", "0",
      "-x264-params", "repeat-headers=1:keyint=30:min-keyint=30:scenecut=0",
      "-c:a", "aac", "-b:a", "64k", "-ar", "44100",
      "-f", "hls",
      "-hls_time", "2",
      "-hls_list_size", "6",
      "-hls_delete_threshold", "3",
      "-hls_segment_type", "fmp4",
      "-hls_fmp4_init_filename", "init.mp4",
      "-hls_flags", "delete_segments+omit_endlist+independent_segments+program_date_time",
      "-hls_segment_filename", segmentos,
      playlist,
    ];
    proceso = spawn(ffmpeg || "ffmpeg", args, { stdio:["ignore","ignore","pipe"], windowsHide:true, cwd: carpeta });
    let err = "";
    log.info(`[${cam.id}] live iniciado · H.264/AAC compatible web`);
    proceso.stderr.on("data", d => { err += d; if (err.length > 5000) err = err.slice(-5000); });
    proceso.on("error", e => {
      log.error(`[${cam.id}] live no pudo iniciar: ${e.message}`);
      proceso = null;
      reintentar();
    });
    proceso.on("close", code => {
      proceso = null;
      if (detenido) return;
      const ult = err.trim().split("\n").slice(-2).join(" | ");
      log.warn(`[${cam.id}] live terminó (código ${code})${ult ? ": "+ult : ""}`);
      reintentar();
    });
  }

  function reintentar() {
    if (detenido || reintento) return;
    reinicios += 1;
    const espera = Math.min(60000, 2000 * Math.pow(2, Math.min(reinicios, 5)));
    reintento = setTimeout(() => {
      reintento = null;
      if (!detenido) lanzar();
    }, espera);
  }

  async function sincronizar() {
    if (subiendo || detenido) return;
    subiendo = true;
    try {
      let nombres = [];
      try { nombres = fs.readdirSync(carpeta); } catch (_) { return; }
      const candidatos = nombres.filter(n => /\.(m4s|mp4|m3u8)$/i.test(n));
      // Los segmentos se suben antes que el playlist para evitar referencias rotas.
      candidatos.sort((a,b) => (a.endsWith(".m3u8") ? 1 : 0) - (b.endsWith(".m3u8") ? 1 : 0));
      for (const nombre of candidatos) {
        const ruta = path.join(carpeta, nombre);
        let st;
        try { st = fs.statSync(ruta); } catch (_) { continue; }
        if (!st.size) continue;
        const firma = st.size + ":" + Math.round(st.mtimeMs);
        if (vistos.get(nombre) === firma) continue;
        const tipo = nombre.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp4";
        const cache = nombre.endsWith(".m3u8") ? "no-store, max-age=0" : "public, max-age=30";
        await subir(ruta, `${prefijo}/${cam.id}/${nombre}`, { contentType:tipo, cacheControl:cache, contentDisposition:null });
        vistos.set(nombre, firma);
      }
    } catch (e) {
      log.warn(`[${cam.id}] live subida: ${e.message}`);
    } finally {
      subiendo = false;
    }
  }

  return {
    id: cam.id,
    iniciar() {
      detenido = false;
      lanzar();
      if (!timer) timer = setInterval(sincronizar, 1500);
      setTimeout(sincronizar, 3000);
    },
    detener() {
      detenido = true;
      if (timer) { clearInterval(timer); timer = null; }
      if (reintento) { clearTimeout(reintento); reintento = null; }
      if (proceso) { try { proceso.kill("SIGTERM"); } catch (_) {} }
    },
    activo() { return !!proceso; },
  };
}

module.exports = { crearPublicadorLive, rtspSecundario };
