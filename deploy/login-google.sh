#!/usr/bin/env bash
# Liga o login com o Google no site da VPS: grava as credenciais no .env.production e reinicia o site.
# Uso (Git Bash, na raiz do repo): bash deploy/login-google.sh
# Antes, crie o "ID do cliente OAuth" no Google Cloud (passo a passo em DEPLOY.md, seção "Login com o Google").
set -euo pipefail
trap 'echo; read -p "Pressione Enter para fechar..."' EXIT

VPS_USER="freshtech"
VPS_HOST="179.197.233.72"
REMOTE_DIR="analiseacao"
SITE="https://acoes.${VPS_HOST}.sslip.io"

echo "Endereço do site [${SITE}]:"
read -r -p "> " RESPOSTA
SITE="${RESPOSTA:-$SITE}"
SITE="${SITE%/}"
echo "ID do cliente (termina com .apps.googleusercontent.com):"
read -r -p "> " CLIENT_ID
echo "Chave secreta do cliente (começa com GOCSPX-):"
read -r -p "> " CLIENT_SECRET
echo "Seu e-mail do Google (a sua conta fica com a carteira que já existe):"
read -r -p "> " ADMIN_EMAIL
[ -n "$CLIENT_ID" ] && [ -n "$CLIENT_SECRET" ] && [ -n "$ADMIN_EMAIL" ] || { echo "❌ Preencha os três."; exit 1; }

echo "==> Gravando no .env.production e reiniciando o site..."
# Os segredos vão pela entrada padrão, para não aparecerem em linha de comando.
printf 'SITE_URL=%s\nGOOGLE_CLIENT_ID=%s\nGOOGLE_CLIENT_SECRET=%s\nADMIN_EMAIL=%s\n' "$SITE" "$CLIENT_ID" "$CLIENT_SECRET" "$ADMIN_EMAIL" |
  ssh "${VPS_USER}@${VPS_HOST}" "cd ~/${REMOTE_DIR} && cat > .login.tmp && \
    grep -vE '^(SITE_URL|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|ADMIN_EMAIL)=' .env.production > .env.novo || true; \
    cat .login.tmp >> .env.novo && rm .login.tmp && chmod 600 .env.novo && mv .env.novo .env.production && \
    docker compose -f docker-compose.prod.yml up -d --force-recreate web agendador"

echo
echo "✅ Login ligado. Abra ${SITE} e entre com ${ADMIN_EMAIL}: a carteira atual passa a ser sua."
