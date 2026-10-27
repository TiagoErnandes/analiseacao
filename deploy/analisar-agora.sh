#!/usr/bin/env bash
# Roda a análise do dia agora, sem esperar as 7h.
# Uso: bash deploy/analisar-agora.sh
set -euo pipefail
trap 'echo; read -p "Pressione Enter para fechar..."' EXIT

VPS_USER="freshtech"
VPS_HOST="179.197.233.72"
REMOTE_DIR="~/analiseacao"

ssh "${VPS_USER}@${VPS_HOST}" \
  "cd ${REMOTE_DIR} && docker compose -f docker-compose.prod.yml exec -T agendador npm run analise"
