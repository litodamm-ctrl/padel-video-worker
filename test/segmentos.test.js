const test = require("node:test");
const assert = require("node:assert/strict");
const { parsearNombre, seleccionar } = require("../src/segmentos.js");

function d(h, m, s) { return new Date(2026, 7, 28, h, m, s || 0); } // 28 ago 2026, hora local

test("parsearNombre lee la fecha y hora local del nombre del segmento", () => {
  assert.deepEqual(parsearNombre("20260828-153000.mp4"), d(15, 30, 0));
  assert.deepEqual(parsearNombre("C:\\grab\\cancha1\\20260828-153000.mp4"), d(15, 30, 0));
  assert.equal(parsearNombre("basura.mp4"), null);
});

test("seleccionar toma solo los segmentos que cubren el rango y calcula el offset", () => {
  const seg = [
    { ruta: "a", inicio: d(15, 0), duracion: 300 },
    { ruta: "b", inicio: d(15, 5), duracion: 300 },
    { ruta: "c", inicio: d(15, 10), duracion: 300 },
    { ruta: "d", inicio: d(15, 15), duracion: 300 },
  ];
  const r = seleccionar(seg, d(15, 6), d(15, 14));
  assert.deepEqual(r.archivos, ["b", "c"]);
  assert.equal(r.offset, 60);        // 15:06 - 15:05
  assert.equal(r.duracion, 480);     // 8 minutos
  assert.equal(r.parcial, false);
});

test("seleccionar marca parcial cuando falta un segmento en el medio", () => {
  const seg = [
    { ruta: "a", inicio: d(15, 0), duracion: 300 },
    // falta 15:05
    { ruta: "c", inicio: d(15, 10), duracion: 300 },
  ];
  const r = seleccionar(seg, d(15, 0), d(15, 15));
  assert.deepEqual(r.archivos, ["a", "c"]);
  assert.equal(r.parcial, true);
  assert.equal(r.faltanteSeg, 300);
});

test("seleccionar marca parcial y recorta cuando la grabación empezó tarde o terminó antes", () => {
  const seg = [
    { ruta: "b", inicio: d(15, 5), duracion: 300 },
    { ruta: "c", inicio: d(15, 10), duracion: 200 }, // el último quedó corto (ffmpeg cayó a las 15:13:20)
  ];
  const r = seleccionar(seg, d(15, 0), d(15, 20));
  assert.deepEqual(r.archivos, ["b", "c"]);
  assert.equal(r.offset, 0);
  assert.equal(r.duracion, 500);     // solo hay 15:05 → 15:13:20
  assert.equal(r.parcial, true);
});

test("seleccionar devuelve null si no hay nada grabado en el rango", () => {
  const seg = [{ ruta: "a", inicio: d(10, 0), duracion: 300 }];
  assert.equal(seleccionar(seg, d(15, 0), d(16, 0)), null);
});

test("seleccionar tolera segmentos con timestamps a pocos segundos del borde", () => {
  const seg = [
    { ruta: "a", inicio: d(15, 0, 1), duracion: 300 },
    { ruta: "b", inicio: d(15, 5, 2), duracion: 300 },
  ];
  const r = seleccionar(seg, d(15, 0), d(15, 10));
  assert.equal(r.parcial, false);
  assert.equal(r.offset, 0);
});
