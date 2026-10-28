#!/usr/bin/env bash
# Envia o app para a VPS e reconstrói os containers (site + agendador).
# Uso (Git Bash, na raiz do repo): bash deploy/deploy.sh
set -euo pipefail
# Pausa no fim para ler o resultado (o vigia automático pula a pausa com DEPLOY_SEM_PAUSA=1)
trap '[ -n "${DEPLOY_SEM_PAUSA:-}" ] || { echo; read -p "Pressione Enter para fechar..."; }' EXIT

VPS_USER="freshtech"
VPS_HOST="179.197.233.72"
REMOTE_DIR="~/analiseacao"

cd "$(dirname "$0")/.."

echo "==> Empacotando..."
# Empacota só o que está commitado (sem node_modules, .env etc.).
git archive --format=tar.gz -o analiseacao.tar.gz HEAD

echo "==> Enviando para a VPS..."
scp analiseacao.tar.gz "${VPS_USER}@${VPS_HOST}:~/"

echo "==> Extraindo e reconstruindo na VPS..."
# Limpa a versão anterior (menos o .env.production) para arquivos apagados não ficarem para trás.
ssh "${VPS_USER}@${VPS_HOST}" \
  "mkdir -p ${REMOTE_DIR} && find ${REMOTE_DIR} -mindepth 1 -maxdepth 1 ! -name .env.production -exec rm -rf {} + && tar xzf ~/analiseacao.tar.gz -C ${REMOTE_DIR} && rm ~/analiseacao.tar.gz && cd ${REMOTE_DIR} && \
   if [ ! -f .env.production ]; then echo '❌ Falta ${REMOTE_DIR}/.env.production na VPS (veja DEPLOY.md, passo 2)'; exit 1; fi && \
   docker compose -f docker-compose.prod.yml up -d --build"

rm -f analiseacao.tar.gz
echo "✅ App atualizado."
