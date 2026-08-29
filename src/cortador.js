/* Lista segmentos grabados, mide su duración con ffprobe y corta el tramo de
   una reserva concatenando segmentos con ffmpeg. */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { parsearNombre, RE_NOMBRE } = require("./segmentos.js");

function ffprobeDe(ffmpeg) {
  // "C:\x\ffmpeg.exe" → "C:\x\ffprobe.exe"; "ffmpeg" → "ffprobe"
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

/* Duración en segundos de un archivo de video (ffprobe). */
async function duracionDe(ruta, ffmpeg) {
  const out = await ejecutar(ffprobeDe(ffmpeg), ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", ruta], { timeoutMs: 30000 });
  const n = parseFloat(String(out).trim());
  if (!isFinite(n)) throw new Error("ffprobe no devolvió duración para " + ruta);
  return n;
}

const cacheDur = new Map(); // ruta|tamaño → duración

/* Segmentos de `dir` cuyo nombre cae cerca del rango [desde, hasta]. Mide con
   ffprobe la duración real (un segmento cortado por un reinicio dura menos). */
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
    // Solo los que pueden tocar el rango: empiezan antes de `hasta` y no más de un segmento antes de `desde`.
    if (inicio > hasta) continue;
    if (inicio.getTime() + (nominal + 60) * 1000 < desde.getTime()) continue;
    const ruta = path.join(dir, n);
    let duracion;
    try {
      const st = fs.statSync(ruta);
      const k = ruta + "|" + st.size;
      if (cacheDur.has(k)) duracion = cacheDur.get(k);
      else { duracion = await duracionDe(ruta, ffmpeg); cacheDur.set(k, duracion); }
    } catch (e) {
      continue; // archivo a medio escribir o corrupto: se omite (quedará como parcial)
    }
    if (!(duracion > 0.5)) continue;
    out.push({ ruta, inicio, duracion });
  }
  out.sort((a, b) => a.inicio - b.inicio);
  return out;
}

/* Corta: concatena `archivos`, salta `offset` segundos y toma `duracion`.
   Recodifica a H.264 720p (alto configurable) para que pese poco y se reproduzca en cualquier teléfono. */
async function cortar({ archivos, offset, duracion, salida, ffmpeg, alto, onProgreso }) {
  const bin = ffmpeg || "ffmpeg";
  const lista = salida + ".lista.txt";
  fs.writeFileSync(lista, archivos.map(a => "file '" + a.replace(/\\/g, "/").replace(/'/g, "'\\''") + "'").join("\n") + "\n");
  const args = [
    "-y", "-hide_banner", "-loglevel", "error", "-nostats",
    "-f", "concat", "-safe", "0", "-i", lista,
    "-ss", String(offset), "-t", String(duracion),
    "-vf", "scale=-2:" + (alto || 720),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k",
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    salida,
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

module.exports = { listarSegmentos, cortar, duracionDe, hayFfmpeg, ejecutar, ffprobeDe };
