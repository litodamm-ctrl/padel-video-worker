/* Subida a Cloudflare R2 por la API compatible con S3.
   Config esperada (config.json → "r2"):
     accountId, accessKeyId, secretAccessKey, bucket,
     publicBaseUrl  → "https://pub-xxxx.r2.dev" o tu dominio (videos.bahiapadel.com)
   La URL pública se guarda en el pedido; padelreplay la firma si tiene
   credenciales, y si no la usa tal cual. */
"use strict";
const fs = require("fs");
const path = require("path");

function crearSubidor(cfg) {
  const { S3Client, PutObjectCommand, HeadBucketCommand } = require("@aws-sdk/client-s3");
  for (const k of ["accountId", "accessKeyId", "secretAccessKey", "bucket"]) {
    if (!cfg || !cfg[k]) throw new Error("Falta r2." + k + " en config.json");
  }
  const cliente = new S3Client({
    region: "auto",
    endpoint: "https://" + cfg.accountId + ".r2.cloudflarestorage.com",
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  const base = String(cfg.publicBaseUrl || "").replace(/\/+$/, "");

  return {
    /* Sube `ruta` como `key`. Devuelve { url, key }. Reintenta 3 veces. */
    async subir(ruta, key, opts) {
      const nombre = (opts && opts.nombreDescarga) || path.basename(key);
      let ultimo = null;
      for (let i = 1; i <= 3; i++) {
        try {
          await cliente.send(new PutObjectCommand({
            Bucket: cfg.bucket,
            Key: key,
            Body: fs.createReadStream(ruta),
            ContentType: "video/mp4",
            ContentLength: fs.statSync(ruta).size,
            ContentDisposition: 'attachment; filename="' + nombre + '"',
            CacheControl: "public, max-age=31536000, immutable",
          }));
          return { url: base ? base + "/" + key : null, key };
        } catch (e) {
          ultimo = e;
          await new Promise(r => setTimeout(r, 3000 * i));
        }
      }
      throw new Error("No se pudo subir a R2: " + (ultimo && ultimo.message));
    },
    async probar() {
      await cliente.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
      return true;
    },
  };
}

/* Clave del objeto en el bucket: videos/AAAA/MM/BP-XXXXXX.mp4 */
function claveDe(codigo, fecha) {
  const [y, m] = String(fecha || "").split("-");
  return "videos/" + (y || "0000") + "/" + (m || "00") + "/" + codigo + ".mp4";
}

module.exports = { crearSubidor, claveDe };
