/* Prueba de integración con ffmpeg real: genera tres segmentos sintéticos de
   10 s, los lista, selecciona el tramo 15:00:05 → 15:00:25 y lo corta. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { listarSegmentos, cortar, duracionDe, hayFfmpeg } = require("../src/cortador.js");
const { seleccionar } = require("../src/segmentos.js");

const FF = process.env.FFMPEG || "ffmpeg";
const disponible = hayFfmpeg(FF);

function generar(dir, nombre, seg) {
  const r = spawnSync(FF, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc=size=320x240:rate=10`,
    "-t", String(seg), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path.join(dir, nombre)]);
  if (r.status !== 0) throw new Error("ffmpeg no pudo generar: " + r.stderr);
}

test("lista, selecciona y corta un tramo de 20 s a partir de tres segmentos de 10 s", { skip: !disponible && "ffmpeg no disponible" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-seg-"));
  generar(dir, "20260828-150000.mp4", 10);
  generar(dir, "20260828-150010.mp4", 10);
  generar(dir, "20260828-150020.mp4", 10);

  const desde = new Date(2026, 7, 28, 15, 0, 5), hasta = new Date(2026, 7, 28, 15, 0, 25);
  const segs = await listarSegmentos(dir, desde, hasta, { ffmpeg: FF, duracionNominal: 10 });
  assert.equal(segs.length, 3);
  assert.ok(Math.abs(segs[0].duracion - 10) < 0.5, "duración medida ≈ 10 s");

  const sel = seleccionar(segs, desde, hasta);
  assert.deepEqual(sel.archivos.map(a => path.basename(a)), ["20260828-150000.mp4", "20260828-150010.mp4", "20260828-150020.mp4"]);
  assert.equal(sel.offset, 5);
  assert.equal(sel.duracion, 20);

  const salida = path.join(dir, "BP-TEST.mp4");
  await cortar({ archivos: sel.archivos, offset: sel.offset, duracion: sel.duracion, salida, ffmpeg: FF, alto: 240 });
  assert.ok(fs.existsSync(salida));
  const dur = await duracionDe(salida, FF);
  assert.ok(Math.abs(dur - 20) < 1, "el corte dura ≈ 20 s, midió " + dur);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("listarSegmentos ignora archivos que no siguen el patrón de nombre", { skip: !disponible && "ffmpeg no disponible" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-seg-"));
  fs.writeFileSync(path.join(dir, "notas.txt"), "x");
  generar(dir, "20260828-150000.mp4", 2);
  const segs = await listarSegmentos(dir, new Date(2026, 7, 28, 15, 0, 0), new Date(2026, 7, 28, 15, 0, 2), { ffmpeg: FF, duracionNominal: 2 });
  assert.equal(segs.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
