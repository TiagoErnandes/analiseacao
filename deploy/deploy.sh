#!/usr/bin/env bash
# Envia o app para a VPS e reconstrói os containers (site + agendador).
# Uso (Git Bash, na raiz do repo): bash deploy/deploy.sh
set -euo pipefail
trap 'echo; read -p "Pressione Enter para fechar..."' EXIT

VPS_USER="freshtech"
VPS_HOST="179.197.233.72"
REMOTE_DIR="~/analiseacao"

cd "$(dirname "$0")/.."

echo "==> Empacotando..."
tar --exclude='node_modules' --exclude='.next' --exclude='.git' --exclude='.env' --exclude='.env.local' --exclude='.env.production' --exclude='*.tar.gz' \
  -czf analiseacao.tar.gz .

echo "==> Enviando para a VPS..."
scp analiseacao.tar.gz "${VPS_USER}@${VPS_HOST}:~/"

echo "==> Extraindo e reconstruindo na VPS..."
ssh "${VPS_USER}@${VPS_HOST}" \
  "mkdir -p ${REMOTE_DIR} && tar xzf ~/analiseacao.tar.gz -C ${REMOTE_DIR} && rm ~/analiseacao.tar.gz && cd ${REMOTE_DIR} && \
   if [ ! -f .env.production ]; then echo '❌ Falta ${REMOTE_DIR}/.env.production na VPS (veja DEPLOY.md, passo 2)'; exit 1; fi && \
   docker compose -f docker-compose.prod.yml up -d --build"

rm -f analiseacao.tar.gz
echo "✅ App atualizado."
