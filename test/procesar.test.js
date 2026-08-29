const test = require("node:test");
const assert = require("node:assert/strict");
const { procesarPedido } = require("../src/procesar.js");

function kvFalso(inicial) {
  const datos = new Map(Object.entries(inicial || {}));
  return {
    datos,
    async get(k) { return datos.has(k) ? datos.get(k) : null; },
    async set(k, v) { datos.set(k, v); return { ok: true }; },
    async del(k) { datos.delete(k); return { ok: true }; },
  };
}
const logMudo = { info() {}, warn() {}, error() {} };
const d = (h, m) => new Date(2026, 7, 28, h, m, 0);

function depsBase(kv, extra) {
  return Object.assign({
    kv, log: logMudo, ffmpeg: "ffmpeg", salidaDir: "salida",
    carpetaDe: court => (court === "Cancha 1" ? "grab/c1" : null),
    listarSegmentos: async () => [
      { ruta: "grab/c1/20260828-140000.mp4", inicio: d(14, 0), duracion: 300 },
      { ruta: "grab/c1/20260828-140500.mp4", inicio: d(14, 5), duracion: 300 },
    ],
    cortar: async ({ salida }) => salida,
    subir: async (ruta, key) => ({ url: "https://videos.test/" + key, key }),
    borrarLocal: () => {},
  }, extra || {});
}

test("un pedido programado termina en 'listo' con la URL del video y el avance reportado", async () => {
  const kv = kvFalso();
  const pasos = [];
  const deps = depsBase(kv, { cortar: async ({ onProgreso, salida }) => { onProgreso(50); return salida; } });
  const pedido = { codigo: "BP-A1", estado: "programado", fecha: "2026-08-28", court: "Cancha 1", startTime: "14:00", endTime: "14:10" };
  const original = kv.set.bind(kv);
  kv.set = async (k, v) => { pasos.push(v.estado + ":" + (v.paso || "") + ":" + v.avance); return original(k, v); };

  const r = await procesarPedido(pedido, deps);

  const final = kv.datos.get("pedido:BP-A1");
  assert.equal(final.estado, "listo");
  assert.equal(final.url, "https://videos.test/videos/2026/08/BP-A1.mp4");
  assert.equal(final.key, "videos/2026/08/BP-A1.mp4");
  assert.equal(final.duracion, 600);
  assert.equal(final.parcial, false);
  assert.equal(final.intentos, 1);
  assert.equal(r.ok, true);
  assert.ok(pasos.some(p => p.startsWith("procesando:buscando grabación")), "reporta que busca");
  assert.ok(pasos.some(p => p.startsWith("procesando:armando el video")), "reporta que arma");
  assert.ok(pasos.some(p => p.startsWith("procesando:subiendo")), "reporta que sube");
});

test("si no hay grabación del horario queda en 'error' con el motivo y cuenta el intento", async () => {
  const kv = kvFalso();
  const deps = depsBase(kv, { listarSegmentos: async () => [] });
  const pedido = { codigo: "BP-B2", estado: "programado", intentos: 1, fecha: "2026-08-28", court: "Cancha 1", startTime: "14:00", endTime: "15:00" };
  const r = await procesarPedido(pedido, deps);
  const final = kv.datos.get("pedido:BP-B2");
  assert.equal(r.ok, false);
  assert.equal(final.estado, "error");
  assert.match(final.error, /grabación/i);
  assert.equal(final.intentos, 2);
});

test("una cancha sin cámara configurada es un error claro, no una excepción", async () => {
  const kv = kvFalso();
  const pedido = { codigo: "BP-C3", estado: "programado", fecha: "2026-08-28", court: "Cancha 9", startTime: "14:00", endTime: "15:00" };
  const r = await procesarPedido(pedido, depsBase(kv));
  assert.equal(r.ok, false);
  assert.match(kv.datos.get("pedido:BP-C3").error, /cámara/i);
});

test("un corte parcial se marca como tal y sigue siendo 'listo'", async () => {
  const kv = kvFalso();
  const deps = depsBase(kv, {
    listarSegmentos: async () => [{ ruta: "grab/c1/20260828-140500.mp4", inicio: d(14, 5), duracion: 300 }],
  });
  const pedido = { codigo: "BP-D4", estado: "pendiente", fecha: "2026-08-28", court: "Cancha 1", startTime: "14:00", endTime: "14:10" };
  await procesarPedido(pedido, deps);
  const final = kv.datos.get("pedido:BP-D4");
  assert.equal(final.estado, "listo");
  assert.equal(final.parcial, true);
  assert.equal(final.duracion, 300);
});
