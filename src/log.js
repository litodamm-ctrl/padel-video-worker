/* Log a consola y a logs/worker-AAAA-MM-DD.log. Se rotan solos por día. */
"use strict";
const fs = require("fs");
const path = require("path");

function crearLog(carpeta) {
  fs.mkdirSync(carpeta, { recursive: true });
  function escribir(nivel, msg) {
    const ahora = new Date();
    const linea = `${ahora.toLocaleString("es-CO", { hour12: false })} [${nivel}] ${msg}`;
    (nivel === "ERROR" ? console.error : console.log)(linea);
    const dia = ahora.getFullYear() + "-" + String(ahora.getMonth() + 1).padStart(2, "0") + "-" + String(ahora.getDate()).padStart(2, "0");
    try { fs.appendFileSync(path.join(carpeta, "worker-" + dia + ".log"), linea + "\n"); } catch (_) {}
  }
  // Borra logs de más de 30 días
  try {
    const limite = Date.now() - 30 * 86400000;
    for (const n of fs.readdirSync(carpeta)) {
      const r = path.join(carpeta, n);
      try { if (fs.statSync(r).mtimeMs < limite) fs.unlinkSync(r); } catch (_) {}
    }
  } catch (_) {}
  return {
    info: m => escribir("INFO", m),
    warn: m => escribir("AVISO", m),
    error: m => escribir("ERROR", m),
  };
}

module.exports = { crearLog };
