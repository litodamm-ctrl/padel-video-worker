# Padel Video Worker · Bahía Padel

Programa que corre en la PC del club. Es la pieza que hace que el video exista:

1. **Graba** cada cámara sin parar, en segmentos de 5 minutos, copiando el stream tal cual (casi no usa CPU).
2. **Revisa la cola** `pedido:*` del manager cada minuto. Cuando una reserva ya terminó, recorta ese tramo exacto, lo pasa a 720p y lo **sube a Cloudflare R2**.
3. **Avisa que está vivo** (`worker:heartbeat`) para que el Panel del manager muestre "Grabación: OK" o "Sin señal".

Solo conoce el código de pedidos (`APP_PEDIDO_CODE`): puede leer `video:*` y escribir `pedido:*` y `worker:*`. Aunque se lleven la PC, no se tocan reservas ni clientes.

## Requisitos en la PC del club

- Windows 10/11 (o Linux), 8 GB de RAM, SSD con ≥ 500 GB libres.
- **Node.js LTS** → https://nodejs.org (instalador normal, deja marcado "Add to PATH").
- **ffmpeg** → https://www.gyan.dev/ffmpeg/builds/ (`ffmpeg-release-essentials.zip`), descomprimido en `C:\ffmpeg`.
- Reloj en hora y zona **America/Bogota** (el corte se hace por hora de pared).
- La cámara y la PC en la misma red (mismo switch PoE).

## Instalación

```powershell
git clone https://github.com/litodamm-ctrl/padel-video-worker.git C:\padel-worker
cd C:\padel-worker
npm install --omit=dev
copy config.example.json config.json
notepad config.json        # completar cámara, códigos y R2 (ver abajo)
node bin\probar-camara.js  # ✔ la cámara responde y graba 8 s de prueba
node bin\probar-nube.js    # ✔ manager y R2 responden
instalar\iniciar.cmd       # verlo trabajar en una ventana (Ctrl+C para parar)
```

Cuando todo esté en verde, instalarlo para que arranque con Windows (PowerShell **como administrador**):

```powershell
cd C:\padel-worker\instalar
Set-ExecutionPolicy -Scope Process Bypass -Force
.\instalar-tarea.ps1
```

Para quitarlo: `.\desinstalar-tarea.ps1`.

## config.json

| Clave | Qué es |
|---|---|
| `kv.url` | `https://padelmanagerb.netlify.app/.netlify/functions/kv` |
| `kv.code` | El `APP_PEDIDO_CODE` que está en Netlify → manager → Environment variables |
| `camaras[].id` | Nombre corto (`cam1`). Se usa como carpeta de grabación |
| `camaras[].rtsp` | URL RTSP de la cámara con usuario y clave (ver tabla) |
| `camaras[].canchas` | Canchas que se ven en esa cámara, con el mismo nombre que en el manager (`"Cancha 1"`) |
| `r2.*` | Cuenta, token y bucket de Cloudflare R2, y la URL pública del bucket |
| `ffmpeg` | `ffmpeg` si está en el PATH, o la ruta completa `C:\\ffmpeg\\bin\\ffmpeg.exe` |
| `retencionHoras` | Cuántas horas se guardan los segmentos crudos (72 por defecto) |
| `margenMinutos` | Minutos después del fin de la reserva antes de cortar (3) |

### URL RTSP según la marca de la cámara

| Marca | URL típica |
|---|---|
| Hikvision / HiLook | `rtsp://usuario:clave@IP:554/Streaming/Channels/101` |
| Dahua / Imou | `rtsp://usuario:clave@IP:554/cam/realmonitor?channel=1&subtype=0` |
| Reolink | `rtsp://usuario:clave@IP:554/h264Preview_01_main` |
| TP-Link Tapo / VIGI | `rtsp://usuario:clave@IP:554/stream1` |
| Ezviz | `rtsp://admin:CODIGO_VERIFICACION@IP:554/H.264` |
| Genérica ONVIF | Búscala en la app de la cámara → "RTSP" o "Stream URL" |

Si la clave tiene `@` o `:`, escríbela codificada (`@` → `%40`, `:` → `%3A`).

## Cómo saber que funciona

- `logs\worker-AAAA-MM-DD.log` muestra `[cam1] grabando →` y cada minuto la cola.
- En `grabaciones\cam1\` aparecen archivos `20260828-153000.mp4` cada 5 minutos.
- En el manager → Panel, arriba dice **Grabación: OK**.
- Al terminar una reserva, en 5–15 minutos el log dice `[BP-XXXX] listo` y el código funciona en padelreplay.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| `La zona horaria de esta PC es "..."` | Cambiar zona horaria de Windows a Bogotá y reiniciar el worker |
| `No encuentro ffmpeg` | Poner la ruta completa en `config.json → ffmpeg` |
| `[cam1] ffmpeg terminó (código 1)` repetido | URL RTSP, usuario o clave incorrectos; probar con `node bin\probar-camara.js` |
| `No hay grabación de ...` en un pedido | La PC estaba apagada o la cámara caída a esa hora; el pedido queda en error y el cliente ve "escríbenos" |
| `kv ... HTTP 401` | `kv.code` no coincide con `APP_PEDIDO_CODE` en Netlify |
| `No se pudo subir a R2` | Token de R2 sin permiso de escritura o bucket mal escrito |
| Panel dice "Sin señal" | La PC está apagada, sin internet o el worker no corre (ver Programador de tareas) |

## Pruebas

```powershell
npm test
```

Incluye una prueba con ffmpeg real que genera tres segmentos sintéticos y corta un tramo.
