@echo off
title Mensalidades em Dia
echo Instalando o Mensalidades em Dia...
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\instalar.ps1"
echo.
pause
