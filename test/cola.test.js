const test = require("node:test");
const assert = require("node:assert/strict");
const { aLocal, pendientes, aRegistro } = require("../src/cola.js");

test('pedidos cerrados y errores agotados no vuelven a buscar reservas', () => {
  const { procesable } = require('../src/cola.js');
  assert.equal(procesable({estado:'cancelado'},new Date()),false);
  assert.equal(procesable({estado:'error',intentos:3},new Date()),false);
});

test("aLocal convierte fecha y hora de la reserva a Date local", () => {
  assert.deepEqual(aLocal("2026-08-28", "15:30"), new Date(2026, 7, 28, 15, 30, 0));
});

test("pendientes devuelve solo pedidos programados cuyo partido terminó hace más del margen", () => {
  const ahora = new Date(2026, 7, 28, 16, 10);
  const pedidos = [
    { codigo: "BP-A", estado: "programado", fecha: "2026-08-28", startTime: "14:00", endTime: "15:00" },
    { codigo: "BP-B", estado: "programado", fecha: "2026-08-28", startTime: "15:00", endTime: "16:08" }, // hace 2 min: aún no
    { codigo: "BP-C", estado: "listo",      fecha: "2026-08-28", startTime: "12:00", endTime: "13:00" },
    { codigo: "BP-D", estado: "pendiente",  fecha: "2026-08-28", startTime: "13:00", endTime: "14:00" },
    { codigo: "BP-E", estado: "programado", fecha: "2026-08-29", startTime: "09:00", endTime: "10:00" }, // mañana
  ];
  const r = pendientes(pedidos, ahora, 5);
  assert.deepEqual(r.map(p => p.codigo), ["BP-D", "BP-A"]); // ordenados por fin
});

test("pendientes reintenta errores hasta tres veces y luego los deja", () => {
  const ahora = new Date(2026, 7, 28, 20, 0);
  const pedidos = [
    { codigo: "BP-A", estado: "error", intentos: 1, fecha: "2026-08-28", startTime: "14:00", endTime: "15:00" },
    { codigo: "BP-B", estado: "error", intentos: 3, fecha: "2026-08-28", startTime: "14:00", endTime: "15:00" },
    { codigo: "BP-C", estado: "procesando", fecha: "2026-08-28", startTime: "14:00", endTime: "15:00" },
  ];
  assert.deepEqual(pendientes(pedidos, ahora, 5).map(p => p.codigo), ["BP-A"]);
});

test("pendientes ignora pedidos sin fecha u hora válidas", () => {
  const ahora = new Date(2026, 7, 28, 20, 0);
  const pedidos = [{ codigo: "BP-X", estado: "programado" }];
  assert.deepEqual(pendientes(pedidos, ahora, 5), []);
});

test("aRegistro completa el pedido con los datos de la reserva video:* cuando faltan", () => {
  const pedido = { estado: "pendiente", ts: 1 };
  const reserva = { fecha: "2026-08-28", court: "Cancha 2", startTime: "10:00", endTime: "11:30" };
  const r = aRegistro("BP-Z", pedido, reserva);
  assert.equal(r.codigo, "BP-Z");
  assert.equal(r.court, "Cancha 2");
  assert.equal(r.endTime, "11:30");
  assert.equal(r.estado, "pendiente");
});

test("dos cámaras tienen cupos independientes y un fallo libera solo su cupo", async () => {
  const { crearTurnos } = require("../src/cola.js");
  const errores = [];
  let terminarA, fallarB;
  const a = new Promise(resolve => { terminarA = resolve; });
  const b = new Promise((_, reject) => { fallarB = reject; });
  const turnos = crearTurnos(2, e => errores.push(e.message));
  assert.equal(turnos.iniciar({ key: "A", recurso: "cam1" }, () => a), true);
  assert.equal(turnos.iniciar({ key: "A", recurso: "cam2" }, () => {}), false);
  assert.equal(turnos.iniciar({ key: "B", recurso: "cam1" }, () => {}), false);
  assert.equal(turnos.iniciar({ key: "B", recurso: "cam2" }, () => b), true);
  assert.equal(turnos.iniciar({ key: "C", recurso: "cam3" }, () => {}), false);
  const activosAlLeer = turnos.claves();
  fallarB(new Error("falló subida"));
  await new Promise(setImmediate);
  assert.deepEqual(errores, ["falló subida"]);
  assert.equal(turnos.cantidad(), 1);
  assert.equal(activosAlLeer.has("B"), true);
  assert.equal(turnos.tiene("B"), false);
  assert.equal(turnos.iniciar({ key: "clip", exclusivo: true }, () => {}), false);
  assert.equal(turnos.iniciar({ key: "C", recurso: "cam2" }, () => {}), true);
  terminarA();
  await new Promise(setImmediate);
  assert.equal(turnos.cantidad(), 0);
});

test("la cola se protege ante poco espacio o falta de segmentos recientes", () => {
  const { motivoPausa } = require("../src/cola.js");
  assert.match(motivoPausa([40, 29], [1000, 1000], 2000, 120000), /espacio/);
  assert.match(motivoPausa([40, 50], [1000, null], 2000, 120000), /cámara/);
  assert.match(motivoPausa([40, 50], [1000, 122000], 122000, 120000), /cámara/);
  assert.equal(motivoPausa([40, 50], [121000, 122000], 122000, 120000), null);
});
