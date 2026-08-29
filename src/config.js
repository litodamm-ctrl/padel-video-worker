/* Lee y valida config.json (copia de config.example.json). Nada de secretos en el código. */
"use strict";
const fs = require("fs");
const path = require("path");

function cargarConfig(ruta) {
  const archivo = ruta || path.join(__dirname, "..", "config.json");
  if (!fs.existsSync(archivo)) {
    throw new Error("No existe " + archivo + ". Copia config.example.json a config.json y complétalo.");
  }
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(archivo, "utf8")); }
  catch (e) { throw new Error("config.json no es JSON válido: " + e.message); }

  const errores = [];
  if (!cfg.kv || !cfg.kv.url) errores.push("kv.url (https://padelmanagerb.netlify.app/.netlify/functions/kv)");
  if (!cfg.kv || !cfg.kv.code) errores.push("kv.code (APP_PEDIDO_CODE del manager)");
  if (!Array.isArray(cfg.camaras) || !cfg.camaras.length) errores.push("camaras (al menos una)");
  (cfg.camaras || []).forEach((c, i) => {
    if (!c.id) errores.push("camaras[" + i + "].id");
    if (!c.rtsp) errores.push("camaras[" + i + "].rtsp");
    if (!Array.isArray(c.canchas) || !c.canchas.length) errores.push("camaras[" + i + "].canchas");
  });
  if (!cfg.r2) errores.push("r2 (accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl)");
  if (errores.length) throw new Error("Faltan datos en config.json: " + errores.join(", "));

  const base = path.dirname(archivo);
  return {
    kv: cfg.kv,
    camaras: cfg.camaras,
    r2: cfg.r2,
    ffmpeg: cfg.ffmpeg || "ffmpeg",
    carpetaGrabaciones: path.resolve(base, cfg.carpetaGrabaciones || "grabaciones"),
    carpetaSalida: path.resolve(base, cfg.carpetaSalida || "videos"),
    segundosSegmento: cfg.segundosSegmento || 300,
    retencionHoras: cfg.retencionHoras || 72,
    margenMinutos: cfg.margenMinutos == null ? 3 : cfg.margenMinutos,
    alto: cfg.alto || 720,
    intervaloColaSeg: cfg.intervaloColaSeg || 60,
    intervaloLatidoSeg: cfg.intervaloLatidoSeg || 60,
    borrarSalidaTrasSubir: cfg.borrarSalidaTrasSubir !== false,
    zonaHoraria: cfg.zonaHoraria || "America/Bogota",
  };
}

/* Carpeta de grabación de la cámara que cubre una cancha. */
function carpetaDeCancha(cfg, court) {
  const c = (cfg.camaras || []).find(cam => (cam.canchas || []).some(n => String(n).trim().toLowerCase() === String(court || "").trim().toLowerCase()));
  return c ? require("path").join(cfg.carpetaGrabaciones, c.id) : null;
}

module.exports = { cargarConfig, carpetaDeCancha };
