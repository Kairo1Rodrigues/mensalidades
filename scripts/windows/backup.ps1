# Copia os backups diários e os comprovantes para uma pasta "backup-AAAA-MM-DD".
# Execute pelo arquivo BACKUP.bat (duplo clique) e depois copie a pasta para um pen drive ou para o Google Drive.
$ErrorActionPreference = 'Continue'
$Raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Raiz
$dest = Join-Path $Raiz ("backup-" + (Get-Date -Format "yyyy-MM-dd"))
New-Item -ItemType Directory -Path $dest -Force | Out-Null
docker compose cp app:/dados/backups $dest
docker compose cp app:/dados/comprovantes $dest
if ($LASTEXITCODE -ne 0) { Write-Host "Não consegui copiar. O sistema está rodando?" -ForegroundColor Red; exit 1 }
Write-Host "Backup salvo em $dest" -ForegroundColor Green
Write-Host "Copie essa pasta para um pen drive ou para o Google Drive."
Start-Process explorer.exe $dest
