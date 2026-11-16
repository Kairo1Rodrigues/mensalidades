# Mensalidades em Dia: instalação (ou atualização) com um comando só.
# No PowerShell do computador da escola, cole:
#   irm https://raw.githubusercontent.com/Kairo1Rodrigues/mensalidades/main/scripts/windows/instalar-rapido.ps1 | iex
#
# O que faz: instala o Docker Desktop (se faltar), baixa o sistema em C:\mensalidades
# e roda o instalador (senha do painel, firewall, energia, sobe o sistema).
# Rodar de novo atualiza o sistema e mantém os dados, a senha e o .env.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue' # deixa o download bem mais rápido no PowerShell 5.1
  $Destino = 'C:\mensalidades'
  $Zip = 'https://github.com/Kairo1Rodrigues/mensalidades/archive/refs/heads/main.zip'
  $DockerExe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'

  Write-Host ''
  Write-Host '== Mensalidades em Dia: instalação rápida ==' -ForegroundColor Green
  Write-Host ''

  # 1. Docker Desktop
  if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and -not (Test-Path $DockerExe)) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      Write-Host 'Não achei o winget para instalar o Docker sozinho.' -ForegroundColor Yellow
      Write-Host 'Instale o Docker Desktop pela página que vai abrir, reinicie o computador e cole este comando de novo.'
      Start-Process 'https://www.docker.com/products/docker-desktop/'
      return
    }
    Write-Host '[1/3] Instalando o Docker Desktop (uns 5 minutos). Clique em Sim se o Windows pedir permissão...' -ForegroundColor Yellow
    winget install --id Docker.DockerDesktop --exact --source winget --accept-package-agreements --accept-source-agreements
    if (-not (Test-Path $DockerExe)) { Write-Host 'A instalação do Docker não terminou. Tire um print desta janela e envie para quem está ajudando você.' -ForegroundColor Red; return }
    Write-Host ''
    Write-Host 'Docker instalado! Agora REINICIE o computador.' -ForegroundColor Green
    Write-Host 'Depois de reiniciar, abra o PowerShell e cole este mesmo comando de novo para terminar.' -ForegroundColor Green
    return
  }
  $env:Path += ";$(Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin')"
  Write-Host '[1/3] Docker Desktop instalado.' -ForegroundColor Green

  # 2. Baixa o sistema (mantém .env e dados de quem já tinha instalado)
  Write-Host '[2/3] Baixando o sistema...' -ForegroundColor Yellow
  $tmp = Join-Path $env:TEMP ("mensalidades-" + [guid]::NewGuid().ToString('n'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    Invoke-WebRequest -Uri $Zip -OutFile (Join-Path $tmp 'main.zip') -UseBasicParsing
    Expand-Archive -Path (Join-Path $tmp 'main.zip') -DestinationPath $tmp -Force
    $origem = Join-Path $tmp 'mensalidades-main'
    New-Item -ItemType Directory -Path $Destino -Force | Out-Null
    # copia tudo por cima, menos o .env (senha e segredos ficam como estão)
    robocopy $origem $Destino /E /XF .env /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "falha ao copiar os arquivos (robocopy $LASTEXITCODE)" }
  } finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  Write-Host "      Sistema em $Destino" -ForegroundColor Green

  # 3. Instalador de sempre (senha, firewall, energia, docker compose)
  Write-Host '[3/3] Configurando e iniciando...' -ForegroundColor Yellow
  Set-Location $Destino
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Destino 'scripts\windows\instalar.ps1')
}
