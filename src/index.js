/* Padel Video Worker · Bahía Padel
   Tres tareas en un solo proceso:
     1. Grabar cada cámara sin parar (segmentos de 5 min).
     2. Cada minuto, revisar la cola pedido:* y producir los videos que ya terminaron.
     3. Cada minuto, escribir worker:heartbeat para que el Panel sepa que está vivo. */
"use strict";
const fs = require("fs");
const path = require("path");
const { cargarConfig, carpetaDeCancha } = require("./config.js");
const { crearLog } = require("./log.js");
const { crearKv } = require("./kv.js");
const { crearGrabador, limpiarAntiguos } = require("./grabador.js");
const { listarSegmentos, cortar, hayFfmpeg } = require("./cortador.js");
const { crearSubidor } = require("./subida.js");
const { pendientes, aRegistro } = require("./cola.js");
const { procesarPedido } = require("./procesar.js");

const VERSION = require("../package.json").version;
const RAIZ = path.join(__dirname, "..");

async function main() {
  const log = crearLog(path.join(RAIZ, "logs"));
  log.info(`Padel Video Worker v${VERSION} arrancando`);

  let cfg;
  try { cfg = cargarConfig(process.argv[2]); }
  catch (e) { log.error(e.message); process.exit(1); }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz !== cfg.zonaHoraria) {
    log.error(`La zona horaria de esta PC es "${tz}" y debe ser "${cfg.zonaHoraria}". Los cortes saldrían a la hora equivocada. Corrígela en Windows (Configuración → Hora e idioma) y reinicia el worker.`);
    process.exit(1);
  }
  if (!hayFfmpeg(cfg.ffmpeg)) {
    log.error(`No encuentro ffmpeg ("${cfg.ffmpeg}"). Instálalo y pon la ruta completa en config.json → "ffmpeg".`);
    process.exit(1);
  }

  const kv = crearKv(cfg.kv);
  try {
    const a = await kv.auth();
    log.info(`Conectado al manager (modo ${a.modo || "?"})`);
    if (a.modo === "admin") log.warn("kv.code es el código ADMIN. Usa APP_PEDIDO_CODE: el worker solo necesita pedidos y video:*.");
  } catch (e) {
    log.error("No pude conectar con el manager: " + e.message);
    process.exit(1);
  }

  let subidor;
  try { subidor = crearSubidor(cfg.r2); }
  catch (e) { log.error(e.message); process.exit(1); }

  fs.mkdirSync(cfg.carpetaSalida, { recursive: true });
  const grabadores = cfg.camaras.map(c => crearGrabador({
    id: c.id, rtsp: c.rtsp, ffmpeg: cfg.ffmpeg, segundosSegmento: cfg.segundosSegmento, log,
    carpeta: path.join(cfg.carpetaGrabaciones, c.id),
  }));
  grabadores.forEach(g => g.iniciar());

  const deps = {
    kv, log, ffmpeg: cfg.ffmpeg, salidaDir: cfg.carpetaSalida, alto: cfg.alto,
    carpetaDe: court => carpetaDeCancha(cfg, court),
    listarSegmentos, cortar,
    subir: (ruta, key, o) => subidor.subir(ruta, key, o),
    borrarLocal: ruta => { if (cfg.borrarSalidaTrasSubir) fs.unlinkSync(ruta); },
  };

  /* ── Cola ── */
  let ocupado = false, ultimaLimpiezaPedidos = 0, enCola = 0;
  async function revisarCola() {
    if (ocupado) return;
    ocupado = true;
    try {
      const items = await kv.listar("pedido:");
      const pedidos = [];
      for (const it of items) {
        if (!it.value || typeof it.value !== "object") continue;
        const codigo = it.key.slice("pedido:".length);
        let r = aRegistro(codigo, it.value, null);
        // Pedidos de versiones viejas (creados por pedir-video) no traen horario: se busca en video:*
        if (!r.endTime && ["programado", "pendiente", "error", "procesando"].includes(r.estado)) {
          const reserva = await kv.get("video:" + codigo);
          if (!reserva) { await kv.set("pedido:" + codigo, Object.assign({}, r, { estado: "error", error: "La reserva ya no existe" })); continue; }
          r = aRegistro(codigo, it.value, reserva);
        }
        pedidos.push(r);
      }
      const lista = pendientes(pedidos, new Date(), cfg.margenMinutos);
      enCola = lista.length;
      if (lista.length) log.info(`Cola: ${lista.length} video(s) por hacer`);
      for (const p of lista) {
        log.info(`[${p.codigo}] ${p.fecha} ${p.startTime}–${p.endTime} · ${p.court}`);
        await procesarPedido(p, deps);
      }
      // Una vez al día: borrar pedidos de hace más de 45 días (el video ya se borró de R2 a los 30).
      if (Date.now() - ultimaLimpiezaPedidos > 86400000) {
        ultimaLimpiezaPedidos = Date.now();
        const limite = Date.now() - 45 * 86400000;
        let n = 0;
        for (const p of pedidos) {
          const ts = p.tsListo || p.tsProceso || p.ts || 0;
          if (ts && ts < limite && (p.estado === "listo" || p.estado === "error" || p.estado === "cancelado")) {
            try { await kv.del("pedido:" + p.codigo); n++; } catch (_) {}
          }
        }
        if (n) log.info(`Limpieza: ${n} pedido(s) viejos borrados`);
      }
    } catch (e) {
      log.error("Cola: " + e.message);
    } finally {
      ocupado = false;
    }
  }

  /* ── Latido ── */
  function discoLibreGB(ruta) {
    try { const s = fs.statfsSync(ruta); return Math.round(s.bavail * s.bsize / 1e9 * 10) / 10; }
    catch (_) { return null; }
  }
  function ultimoSegmento(carpeta) {
    try {
      let max = 0;
      for (const n of fs.readdirSync(carpeta)) {
        if (!/\.mp4$/i.test(n)) continue;
        const m = fs.statSync(path.join(carpeta, n)).mtimeMs;
        if (m > max) max = m;
      }
      return max || null;
    } catch (_) { return null; }
  }
  async function latir() {
    try {
      await kv.set("worker:heartbeat", {
        ts: Date.now(),
        version: VERSION,
        pc: require("os").hostname(),
        discoLibreGB: discoLibreGB(cfg.carpetaGrabaciones),
        enCola,
        camaras: grabadores.map(g => ({ id: g.id, grabando: g.grabando(), ultimoSegmento: ultimoSegmento(g.carpeta) })),
      });
    } catch (e) {
      log.warn("Latido: " + e.message);
    }
  }

  /* ── Limpieza de segmentos ── */
  function limpiar() {
    for (const g of grabadores) {
      const n = limpiarAntiguos(g.carpeta, cfg.retencionHoras);
      if (n) log.info(`[${g.id}] borrados ${n} segmentos de más de ${cfg.retencionHoras} h`);
    }
  }

  setTimeout(revisarCola, 5000);
  setInterval(revisarCola, cfg.intervaloColaSeg * 1000);
  setTimeout(latir, 2000);
  setInterval(latir, cfg.intervaloLatidoSeg * 1000);
  setInterval(limpiar, 3600 * 1000);
  limpiar();

  function salir(senal) {
    log.info(`Recibido ${senal}: deteniendo grabación`);
    grabadores.forEach(g => g.detener());
    setTimeout(() => process.exit(0), 1500);
  }
  process.on("SIGINT", () => salir("SIGINT"));
  process.on("SIGTERM", () => salir("SIGTERM"));
  process.on("uncaughtException", e => log.error("Excepción no controlada: " + (e.stack || e.message)));
  process.on("unhandledRejection", e => log.error("Promesa rechazada: " + (e && e.stack || e)));
}

main();
