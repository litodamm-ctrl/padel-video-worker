/* Comprueba la conexión con el manager (kv) y con Cloudflare R2.
   Uso: node bin/probar-nube.js */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { cargarConfig } = require("../src/config.js");
const { crearKv } = require("../src/kv.js");
const { crearSubidor } = require("../src/subida.js");

(async () => {
  let cfg;
  try { cfg = cargarConfig(); } catch (e) { console.error("✖ " + e.message); process.exit(1); }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log((tz === cfg.zonaHoraria ? "✔" : "✖") + ` Zona horaria de la PC: ${tz}` + (tz === cfg.zonaHoraria ? "" : ` (debe ser ${cfg.zonaHoraria})`));
  console.log("  Hora de la PC: " + new Date().toLocaleString("es-CO", { hour12: false }) + "  ← compárala con tu teléfono");

  let fallos = 0;
  try {
    const kv = crearKv(cfg.kv);
    const a = await kv.auth();
    if (a.modo === "pedido") console.log("✔ Manager: conectado con el código de pedidos (correcto)");
    else if (a.modo === "admin") { console.log("⚠ Manager: conectado con el código ADMIN. Cámbialo por APP_PEDIDO_CODE."); }
    else { console.log("✖ Manager: el código es de solo lectura; el worker necesita APP_PEDIDO_CODE."); fallos++; }
    const items = await kv.listar("pedido:");
    console.log(`  Pedidos en la cola: ${items.length}`);
    await kv.set("worker:prueba", { ts: Date.now() });
    await kv.del("worker:prueba");
    console.log("✔ Manager: puedo escribir worker:*");
  } catch (e) { fallos++; console.log("✖ Manager: " + e.message); }

  try {
    const s = crearSubidor(cfg.r2);
    const tmp = path.join(os.tmpdir(), "bp-prueba.txt");
    fs.writeFileSync(tmp, "prueba " + new Date().toISOString());
    const r = await s.subir(tmp, "_prueba/ok.txt", { nombreDescarga: "ok.txt" });
    console.log("✔ R2: subí _prueba/ok.txt al bucket " + cfg.r2.bucket);
    if (r.url) console.log("  Ábrelo en el navegador para confirmar el acceso público: " + r.url);
    else console.log("⚠ r2.publicBaseUrl está vacío: los videos se subirán pero no tendrán URL pública.");
  } catch (e) { fallos++; console.log("✖ R2: " + e.message); }

  console.log(fallos ? `\n${fallos} problema(s).` : "\nTodo bien: nube lista.");
  process.exit(fallos ? 1 : 0);
})();
