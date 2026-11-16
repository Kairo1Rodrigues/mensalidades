@echo off
title Mensalidades em Dia
echo Fazendo backup do Mensalidades em Dia...
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\backup.ps1"
echo.
pause
