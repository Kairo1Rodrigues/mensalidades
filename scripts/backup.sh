#!/usr/bin/env bash
# Copia os backups diários e os comprovantes do servidor para a pasta ./backup-AAAA-MM-DD
# (depois baixe essa pasta para o seu computador, por exemplo com: scp -r ubuntu@IP:mensalidades/backup-* .)
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="backup-$(date +%F)"
mkdir -p "$DEST"
sudo docker compose cp app:/dados/backups "$DEST/"
sudo docker compose cp app:/dados/comprovantes "$DEST/"
sudo chown -R "$USER" "$DEST"
echo "Backup em $DEST"
