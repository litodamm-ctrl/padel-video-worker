/* Subida y descarga a Cloudflare R2 por la API compatible con S3. */
"use strict";
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");

function crearSubidor(cfg) {
  const { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand } = require("@aws-sdk/client-s3");
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
    async descargar(key, destino) {
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      const r = await cliente.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      if (!r.Body) throw new Error("R2 no devolvió contenido para " + key);
      await pipeline(r.Body, fs.createWriteStream(destino));
      return destino;
    },
    async probar() {
      await cliente.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
      return true;
    },
  };
}

function claveDe(codigo, fecha) {
  const [y, m] = String(fecha || "").split("-");
  return "videos/" + (y || "0000") + "/" + (m || "00") + "/" + codigo + ".mp4";
}

function claveCorteDe(codigo, fecha, id) {
  const [y, m] = String(fecha || "").split("-");
  return "cortes/" + (y || "0000") + "/" + (m || "00") + "/" + codigo + "-" + id + ".mp4";
}

module.exports = { crearSubidor, claveDe, claveCorteDe };
