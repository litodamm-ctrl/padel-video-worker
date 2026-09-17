/* Comprueba que la cámara responde y que ffmpeg puede grabarla.
   Uso:  node bin/probar-camara.js                 (usa las cámaras de config.json)
         node bin/probar-camara.js rtsp://...      (prueba una URL suelta) */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

let ffmpeg = "ffmpeg", camaras = [];
const arg = process.argv[2];
if (arg && /^rtsp/i.test(arg)) {
  camaras = [{ id: "prueba", rtsp: arg }];
  try { ffmpeg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8")).ffmpeg || "ffmpeg"; } catch (_) {}
} else {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8"));
    ffmpeg = cfg.ffmpeg || "ffmpeg"; camaras = cfg.camaras || [];
  } catch (e) { console.error("No pude leer config.json: " + e.message); process.exit(1); }
}
const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m, e) => "ffprobe" + (e || ""));

const v = spawnSync(ffmpeg, ["-version"], { encoding: "utf8" });
if (v.status !== 0) { console.error(`✖ No encuentro ffmpeg en "${ffmpeg}". Instálalo y pon la ruta en config.json.`); process.exit(1); }
console.log("✔ " + v.stdout.split("\n")[0]);

let fallos = 0;
for (const c of camaras) {
  console.log(`\n── Cámara ${c.id} · ${c.rtsp.replace(/:[^:@/]+@/, ":****@")}`);
  const p = spawnSync(ffprobe, ["-v", "error", "-rtsp_transport", "tcp", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,r_frame_rate", "-of", "default=nw=1", c.rtsp],
    { encoding: "utf8", timeout: 20000 });
  if (p.status !== 0) {
    fallos++;
    console.log("✖ La cámara no respondió en 20 s.");
    console.log("  " + (p.stderr || "").trim().split("\n").slice(-2).join("\n  "));
    console.log("  Revisa: IP, usuario/clave, que la PC esté en la misma red y que la ruta RTSP sea la de tu marca.");
    continue;
  }
  console.log("✔ Responde:\n  " + p.stdout.trim().replace(/\n/g, "\n  "));

  const pa = spawnSync(ffprobe, ["-v", "error", "-rtsp_transport", "tcp", "-select_streams", "a:0",
    "-show_entries", "stream=codec_name,sample_rate,channels", "-of", "default=nw=1", c.rtsp],
    { encoding: "utf8", timeout: 20000 });
  if (pa.status === 0 && String(pa.stdout || "").trim()) {
    console.log("✔ Audio detectado:\n  " + pa.stdout.trim().replace(/\n/g, "\n  "));
  } else {
    console.log("⚠ No detecté audio en este RTSP. Si la cámara tiene micrófono, activa Audio en el stream principal.");
  }

  const out = path.join(os.tmpdir(), "bp-prueba-" + c.id + ".mp4");
  const g = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-rtsp_transport", "tcp", "-i", c.rtsp, "-t", "8", "-c", "copy", out],
    { encoding: "utf8", timeout: 40000 });
  if (g.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 10000) {
    console.log(`✔ Grabé 8 s de prueba (${Math.round(fs.statSync(out).size / 1024)} KB) en ${out}`);
    console.log("  Ábrelo con el reproductor de Windows para confirmar que se ve la cancha.");
  } else {
    fallos++;
    console.log("✖ Responde pero no pude grabar: " + (g.stderr || "").trim().split("\n").slice(-2).join(" | "));
  }
}
console.log(fallos ? `\n${fallos} cámara(s) con problemas.` : "\nTodo bien: las cámaras están listas para el worker.");
process.exit(fallos ? 1 : 0);
