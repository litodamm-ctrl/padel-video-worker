# Detiene y quita la tarea programada del worker. Ejecutar como administrador.
$nombre = "PadelVideoWorker"
if (Get-ScheduledTask -TaskName $nombre -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $nombre -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $nombre -Confirm:$false
  Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.CommandLine -match "index.js" } | Stop-Process -Force -ErrorAction SilentlyContinue
  Write-Host "Tarea '$nombre' eliminada." -ForegroundColor Green
} else {
  Write-Host "La tarea '$nombre' no existe."
}
