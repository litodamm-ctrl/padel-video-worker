@echo off
rem Arranca el worker en esta ventana para verlo trabajar. Ctrl+C lo detiene.
cd /d "%~dp0.."
node src\index.js
pause
