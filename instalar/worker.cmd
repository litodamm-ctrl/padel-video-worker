@echo off
rem Bucle que mantiene vivo el worker. Lo lanza la tarea programada al arrancar Windows.
cd /d "%~dp0.."
if not exist logs mkdir logs
:loop
node src\index.js
echo [%date% %time%] El worker termino con codigo %errorlevel%. Reinicio en 15 s >> logs\reinicios.log
timeout /t 15 /nobreak >nul
goto loop
