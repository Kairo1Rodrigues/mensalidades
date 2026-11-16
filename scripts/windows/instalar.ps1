# Instala o Mensalidades em Dia num computador Windows da escola.
# Execute pelo arquivo INSTALAR.bat (duplo clique).
$ErrorActionPreference = 'Continue'
$Raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Raiz

function Ok($t)    { Write-Host $t -ForegroundColor Green }
function Aviso($t) { Write-Host $t -ForegroundColor Yellow }
function Erro($t)  { Write-Host $t -ForegroundColor Red }

Ok "== Mensalidades em Dia: instalação no computador da escola =="
Write-Host ""

# 1. Docker Desktop instalado?
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Erro "O Docker Desktop não está instalado."
  Write-Host "Vou abrir a página de download. Instale, reinicie o computador e rode o INSTALAR.bat de novo."
  Start-Process "https://www.docker.com/products/docker-desktop/"
  exit 1
}

# 2. Docker Desktop aberto?
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Aviso "Abrindo o Docker Desktop (pode levar alguns minutos)..."
  $exe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  if (Test-Path $exe) { Start-Process $exe }
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 5
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { break }
  }
  if ($LASTEXITCODE -ne 0) {
    Erro "O Docker Desktop não ficou pronto. Abra o Docker Desktop, espere aparecer 'Engine running' e rode o INSTALAR.bat de novo."
    exit 1
  }
}
Ok "Docker Desktop funcionando."

# 3. Configuração (.env)
$envArq = Join-Path $Raiz ".env"
function Segredo($bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return ($b | ForEach-Object { $_.ToString("x2") }) -join ""
}
if (-not (Test-Path $envArq)) {
  while ($true) {
    $s = Read-Host "Crie a senha do painel (mínimo 8 caracteres, sem aspas simples)" -AsSecureString
    $senha = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
    if ($senha.Length -ge 8 -and -not $senha.Contains("'")) { break }
    Aviso "A senha precisa ter pelo menos 8 caracteres e não pode ter aspas simples (')."
  }
  $linhas = @(
    "SENHA_PAINEL='$senha'",
    "WEBHOOK_SECRET=$(Segredo 24)",
    "EVOLUTION_API_KEY=$(Segredo 24)",
    "POSTGRES_SENHA=$(Segredo 16)",
    "PORTA_PAINEL=80",
    "COOKIE_SECURE=0"
  )
  # UTF-8 sem BOM: o Docker não entende o BOM
  [System.IO.File]::WriteAllText($envArq, (($linhas -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
  Ok "Configuração criada."
} else {
  Aviso "Arquivo .env já existe: mantendo a configuração atual."
}

# 4. Firewall, e não deixar o computador dormir (pede permissão de administrador uma vez)
Aviso "O Windows vai pedir permissão para liberar o painel na rede e impedir que o computador durma. Clique em Sim."
$cmd = @'
if (-not (Get-NetFirewallRule -DisplayName 'Mensalidades em Dia (painel)' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'Mensalidades em Dia (painel)' -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow -Profile Any | Out-Null
}
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
'@
try {
  $cod = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
  Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $cod"
  Ok "Rede e energia configuradas."
} catch {
  Aviso "Não deu para configurar o firewall e a energia (permissão negada). O painel funciona neste computador; para os celulares, veja o guia, 'Problemas comuns'."
}

# 5. Sobe tudo
Ok "Construindo e iniciando o sistema (a primeira vez demora de 5 a 15 minutos)..."
docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
  Erro "Algo deu errado ao iniciar. Tire um print desta janela e envie para quem está ajudando você."
  exit 1
}

# 6. Espera o painel responder
Ok "Aguardando o painel ficar no ar..."
$noAr = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost/entrar" -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -eq 200) { $noAr = $true; break }
  } catch { }
  Start-Sleep -Seconds 5
}
if (-not $noAr) {
  Erro "O painel não respondeu. Rode no PowerShell: docker compose logs app"
  exit 1
}

# 7. Atalho na área de trabalho
$desktop = [Environment]::GetFolderPath('Desktop')
[System.IO.File]::WriteAllText((Join-Path $desktop "Mensalidades em Dia.url"), "[InternetShortcut]`r`nURL=http://localhost/`r`n")

# 8. Endereço para os celulares
$ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Loopback|Docker|VirtualBox|VMware' } |
  Select-Object -First 1 -ExpandProperty IPAddress

Write-Host ""
Ok "Pronto! O sistema está rodando."
Write-Host ""
Write-Host "  Neste computador:          http://localhost   (atalho criado na área de trabalho)"
if ($ip) { Write-Host "  Nos celulares da escola:   http://$ip   (conectados no mesmo Wi-Fi)" }
Write-Host ""
Write-Host "Próximos passos: entre com a senha, vá em Ajustes, depois Alunos (Importar lista) e WhatsApp (QR Code)."
Start-Process "http://localhost/"
