/* Lista segmentos grabados, mide su duración con ffprobe y corta el tramo de
   una reserva concatenando segmentos con ffmpeg. */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { parsearNombre, RE_NOMBRE } = require("./segmentos.js");

function ffprobeDe(ffmpeg) {
  return String(ffmpeg || "ffmpeg").replace(/ffmpeg(\.exe)?$/i, (m, ext) => "ffprobe" + (ext || ""));
}
function hayFfmpeg(ffmpeg) {
  try { return spawnSync(ffmpeg || "ffmpeg", ["-version"], { stdio: "ignore" }).status === 0; }
  catch (_) { return false; }
}
function ejecutar(bin, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "", err = "";
    p.stdout.on("data", d => { out += d; });
    p.stderr.on("data", d => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    const t = opts && opts.timeoutMs ? setTimeout(() => { p.kill(); reject(new Error(bin + " excedió el tiempo")); }, opts.timeoutMs) : null;
    p.on("error", e => { if (t) clearTimeout(t); reject(e); });
    p.on("close", code => {
      if (t) clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new Error(path.basename(bin) + " terminó con código " + code + ": " + err.trim().split("\n").slice(-3).join(" | ")));
    });
  });
}
async function duracionDe(ruta, ffmpeg) {
  const out = await ejecutar(ffprobeDe(ffmpeg), ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", ruta], { timeoutMs: 30000 });
  const n = parseFloat(String(out).trim());
  if (!isFinite(n)) throw new Error("ffprobe no devolvió duración para " + ruta);
  return n;
}
const cacheDur = new Map();
async function listarSegmentos(dir, desde, hasta, opts) {
  const ffmpeg = (opts && opts.ffmpeg) || "ffmpeg";
  const nominal = (opts && opts.duracionNominal) || 300;
  let nombres = [];
  try { nombres = fs.readdirSync(dir); } catch (_) { return []; }
  const out = [];
  for (const n of nombres) {
    if (!RE_NOMBRE.test(n)) continue;
    const inicio = parsearNombre(n);
    if (!inicio) continue;
    if (inicio > hasta) continue;
    if (inicio.getTime() + (nominal + 60) * 1000 < desde.getTime()) continue;
    const ruta = path.join(dir, n);
    let duracion;
    try {
      const st = fs.statSync(ruta);
      const k = ruta + "|" + st.size;
      if (cacheDur.has(k)) duracion = cacheDur.get(k);
      else { duracion = await duracionDe(ruta, ffmpeg); cacheDur.set(k, duracion); }
    } catch (_) { continue; }
    if (!(duracion > 0.5)) continue;
    out.push({ ruta, inicio, duracion });
  }
  out.sort((a, b) => a.inicio - b.inicio);
  return out;
}

/* La cámara ya entrega la imagen en la orientación correcta para la instalación
   física del club. Solo escalamos y agregamos una marca discreta abajo. */
function filtroBahia(alto) {
  const h = alto || 720;
  return [
    "setpts=PTS-STARTPTS",
    "fps=25:round=near",
    "scale=-2:" + h,
    "drawtext=text='Bahía Padel Social Club':fontcolor=white@0.92:fontsize=28:box=1:boxcolor=black@0.42:boxborderw=10:x=(w-text_w)/2:y=h-text_h-24",
  ].join(",");
}

async function cortar({ archivos, offset, duracion, salida, ffmpeg, alto, onProgreso }) {
  const bin = ffmpeg || "ffmpeg";
  const lista = salida + ".lista.txt";
  fs.writeFileSync(lista, archivos.map(a => "file '" + a.replace(/\\/g, "/").replace(/'/g, "'\\''") + "'").join("\n") + "\n");
  const args = [
    "-y", "-hide_banner", "-loglevel", "error", "-nostats",
    "-fflags", "+genpts+discardcorrupt",
    "-f", "concat", "-safe", "0", "-i", lista,
    "-ss", String(offset), "-t", String(duracion),
    "-map", "0:v:0", "-map", "0:a?",
    "-vf", filtroBahia(alto),
    "-af", "aresample=48000:async=1000:first_pts=0",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-fps_mode", "cfr",
    "-c:a", "aac", "-b:a", "128k",
    "-avoid_negative_ts", "make_zero",
    "-max_interleave_delta", "0",
    "-movflags", "+faststart",
    "-progress", "pipe:1", salida,
  ];
  await new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let err = "";
    p.stderr.on("data", d => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    p.stdout.on("data", d => {
      if (!onProgreso) return;
      const m = /out_time_ms=(\d+)/.exec(String(d));
      if (m) onProgreso(Math.min(100, Math.round((+m[1] / 1e6) / duracion * 100)));
    });
    p.on("error", reject);
    p.on("close", code => {
      try { fs.unlinkSync(lista); } catch (_) {}
      if (code === 0) resolve();
      else reject(new Error("ffmpeg terminó con código " + code + ": " + err.trim().split("\n").slice(-3).join(" | ")));
    });
  });
  return salida;
}

async function cortarClip({ entrada, inicioSeg, duracion, salida, ffmpeg, onProgreso, normalizado }) {
  const bin = ffmpeg || "ffmpeg";
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-nostats",
    "-fflags", "+genpts+discardcorrupt",
    "-ss", String(inicioSeg), "-i", entrada, "-t", String(duracion),
    "-map", "0:v:0", "-map", "0:a?"
  ];
  args.push("-vf", normalizado ? "setpts=PTS-STARTPTS,fps=25:round=near" : filtroBahia(720));
  args.push(
    "-af", "aresample=48000,asetpts=N/SR/TB",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-fps_mode", "cfr",
    "-c:a", "aac", "-b:a", "128k",
    "-avoid_negative_ts", "make_zero",
    "-max_interleave_delta", "0",
    "-movflags", "+faststart",
    "-progress", "pipe:1", salida
  );
  await new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let err = "";
    p.stderr.on("data", d => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    p.stdout.on("data", d => {
      if (!onProgreso) return;
      const m = /out_time_ms=(\d+)/.exec(String(d));
      if (m) onProgreso(Math.min(100, Math.round((+m[1] / 1e6) / duracion * 100)));
    });
    p.on("error", reject);
    p.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error("ffmpeg clip terminó con código " + code + ": " + err.trim().split("\n").slice(-3).join(" | ")));
    });
  });
  return salida;
}

module.exports = { listarSegmentos, cortar, cortarClip, duracionDe, hayFfmpeg, ejecutar, ffprobeDe, filtroBahia };
