/* Cliente de la función kv del manager (padelmanagerb). El worker entra con
   el código de pedidos (APP_PEDIDO_CODE): solo puede leer video:*, leer y
   escribir pedido:* y worker:*. Aunque se lleven la PC, no tocan reservas. */
"use strict";

function crearKv({ url, code, fetchImpl }) {
  const f = fetchImpl || globalThis.fetch;
  if (!url || !code) throw new Error("Falta kv.url o kv.code en config.json");

  async function llamar(action, extra) {
    const r = await f(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ code, action }, extra || {})),
    });
    const txt = await r.text();
    let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (_) {}
    if (!r.ok) throw new Error("kv " + action + " → HTTP " + r.status + (data && data.error ? ": " + data.error : ""));
    return data;
  }

  return {
    async get(key) {
      const res = await llamar("get", { key });
      if (!res || res.value == null) return null;
      try { return JSON.parse(res.value); } catch (_) { return res.value; }
    },
    async set(key, value) {
      return llamar("set", { key, value: JSON.stringify(value) });
    },
    async del(key) {
      return llamar("delete", { key });
    },
    /* Todos los pedidos de una vez: [{ key, value(objeto) }]. Usa listv si el
       manager lo tiene; si no, cae a list + get uno por uno. */
    async listar(prefix) {
      try {
        const res = await llamar("listv", { prefix });
        return (res.items || []).map(it => ({ key: it.key, value: parse(it.value) }));
      } catch (e) {
        if (!/Acción desconocida|400/.test(e.message)) throw e;
        const res = await llamar("list", { prefix });
        const out = [];
        for (const key of res.keys || []) {
          const v = await llamar("get", { key });
          out.push({ key, value: v && v.value != null ? parse(v.value) : null });
        }
        return out;
      }
    },
    async auth() { return llamar("auth", {}); },
  };
}

function parse(v) { try { return JSON.parse(v); } catch (_) { return v; } }

module.exports = { crearKv };
