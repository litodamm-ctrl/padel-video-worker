# Instala el worker como tarea programada que arranca con Windows (sin nadie logueado)
# y se reinicia sola si falla. Ejecutar en PowerShell COMO ADMINISTRADOR:
#   Set-ExecutionPolicy -Scope Process Bypass -Force; .\instalar-tarea.ps1
$ErrorActionPreference = "Stop"
$nombre = "PadelVideoWorker"
$raiz = Split-Path -Parent $PSScriptRoot
$cmd = Join-Path $PSScriptRoot "worker.cmd"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "No encuentro node.exe en el PATH. Instala Node.js LTS desde https://nodejs.org y vuelve a abrir PowerShell." -ForegroundColor Red
  exit 1
}
if (-not (Test-Path (Join-Path $raiz "config.json"))) {
  Write-Host "Falta config.json en $raiz (copia config.example.json y complétalo)." -ForegroundColor Red
  exit 1
}
if (-not (Test-Path (Join-Path $raiz "node_modules"))) {
  Write-Host "Instalando dependencias (npm install)..."
  Push-Location $raiz; npm install --omit=dev; Pop-Location
}

$accion = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$cmd`"" -WorkingDirectory $raiz
$disparador = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$ajustes = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

if (Get-ScheduledTask -TaskName $nombre -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $nombre -Confirm:$false
}
Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $disparador -Principal $principal -Settings $ajustes -Description "Bahía Padel · graba las canchas y produce los videos de cada reserva" | Out-Null
Start-ScheduledTask -TaskName $nombre
Start-Sleep -Seconds 3
$estado = (Get-ScheduledTask -TaskName $nombre).State
Write-Host "Tarea '$nombre' instalada y en estado: $estado" -ForegroundColor Green
Write-Host "Logs: $raiz\logs\  ·  Para verla: Programador de tareas → Biblioteca → $nombre"
