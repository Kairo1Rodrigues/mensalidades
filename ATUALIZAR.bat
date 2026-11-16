@echo off
title Mensalidades em Dia
echo Atualizando o Mensalidades em Dia...
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\atualizar.ps1"
echo.
pause
