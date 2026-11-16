# Baixa a versão mais nova do Mensalidades em Dia e reinicia. Os dados e a senha são mantidos.
# Execute pelo arquivo ATUALIZAR.bat (duplo clique).
$ErrorActionPreference = 'Continue'
$Raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Raiz
$Repo = "https://github.com/Kairo1Rodrigues/mensalidades/archive/refs/heads/main.zip"

Write-Host "Baixando a versão mais nova..." -ForegroundColor Green
$tmp = Join-Path $env:TEMP ("mensalidades-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $Repo -OutFile (Join-Path $tmp "m.zip") -UseBasicParsing
  Expand-Archive -Path (Join-Path $tmp "m.zip") -DestinationPath $tmp -Force
  $novo = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1
  # copia tudo por cima, menos o .env (senha e chaves desta escola) e os backups
  robocopy $novo.FullName $Raiz /E /XF .env /XD backup-* /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy falhou ($LASTEXITCODE)" }
} catch {
  Write-Host "Não consegui baixar a atualização. Verifique a internet e tente de novo." -ForegroundColor Red
  exit 1
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

Write-Host "Reiniciando o sistema..." -ForegroundColor Green
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Write-Host "Algo deu errado. Tire um print desta janela." -ForegroundColor Red; exit 1 }
Write-Host "Atualizado!" -ForegroundColor Green
