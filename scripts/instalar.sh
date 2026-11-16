#!/usr/bin/env bash
# Instala o Mensalidades em Dia num servidor Ubuntu (feito para a Oracle Cloud Free).
# Uso: ./scripts/instalar.sh
set -euo pipefail
cd "$(dirname "$0")/.."

verde() { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }

verde "== Mensalidades em Dia: instalação =="

# 1. Docker
if ! command -v docker >/dev/null 2>&1; then
  verde "Instalando o Docker…"
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER" || true
DOCKER="sudo docker"

# 2. Firewall interno: as imagens Ubuntu da Oracle bloqueiam as portas 80 e 443 por padrão
verde "Liberando as portas 80 e 443 no firewall do servidor…"
for porta in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$porta" -m state --state NEW -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT -p tcp --dport "$porta" -m state --state NEW -j ACCEPT
done
if command -v netfilter-persistent >/dev/null 2>&1; then sudo netfilter-persistent save >/dev/null 2>&1 || true; fi

# 3. Memória extra (swap) nas máquinas pequenas
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 3000 ] && ! swapon --show | grep -q .; then
  verde "Máquina com ${MEM_MB} MB de RAM: criando 2 GB de swap…"
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# 4. Configuração (.env)
if [ ! -f .env ]; then
  echo
  read -rp "Endereço do painel (ex.: minhaescola.duckdns.org): " DOMINIO
  while true; do
    read -rsp "Crie a senha do painel (mínimo 8 caracteres): " SENHA; echo
    [ "${#SENHA}" -ge 8 ] && break
    amarelo "A senha precisa ter pelo menos 8 caracteres."
  done
  read -rp "Token do DuckDNS (opcional, mantém o endereço atualizado; Enter para pular): " DUCK
  umask 077
  cat > .env <<EOF
DOMINIO=${DOMINIO}
SENHA_PAINEL=${SENHA}
WEBHOOK_SECRET=$(openssl rand -hex 24)
EVOLUTION_API_KEY=$(openssl rand -hex 24)
POSTGRES_SENHA=$(openssl rand -hex 16)
EOF
  if [ -n "${DUCK}" ]; then
    SUB="${DOMINIO%%.duckdns.org}"
    LINHA="*/5 * * * * curl -fsS 'https://www.duckdns.org/update?domains=${SUB}&token=${DUCK}&ip=' >/dev/null 2>&1"
    ( crontab -l 2>/dev/null | grep -v duckdns.org; echo "$LINHA" ) | crontab -
    curl -fsS "https://www.duckdns.org/update?domains=${SUB}&token=${DUCK}&ip=" >/dev/null && verde "DuckDNS atualizado."
  fi
else
  amarelo "Arquivo .env já existe: mantendo a configuração atual."
fi
DOMINIO=$(grep '^DOMINIO=' .env | cut -d= -f2)

# 5. Sobe tudo
verde "Construindo e iniciando os serviços (a primeira vez demora uns 5 minutos)…"
$DOCKER compose up -d --build

# 6. Espera o painel responder
verde "Aguardando o painel ficar no ar…"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "https://${DOMINIO}/entrar" 2>/dev/null; then
    echo; verde "Pronto! Acesse: https://${DOMINIO}"
    echo "Depois de entrar: aba Ajustes (nome da escola), aba Alunos (Importar lista) e aba WhatsApp (QR Code)."
    exit 0
  fi
  sleep 5
done
amarelo "Os serviços subiram, mas o endereço https://${DOMINIO} ainda não respondeu."
amarelo "Confira se o DuckDNS aponta para o IP desta máquina e se as portas 80 e 443 estão liberadas na Oracle (guia, parte 3)."
amarelo "Logs: sudo docker compose logs caddy"
