#!/usr/bin/env bash
# Baixa a versão mais nova do sistema e reinicia. Os dados não são apagados.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
sudo docker compose up -d --build
echo "Atualizado."
