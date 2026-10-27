#!/usr/bin/env bash
# Configuração da primeira vez na VPS, num comando só.
# Uso (Git Bash, na raiz do repo): bash deploy/configurar.sh
#
# Pergunta só a chave da Anthropic. O resto é automático:
# senha do banco, .env.production, Nginx, HTTPS (se der) e subida dos containers.
# A VPS vai pedir a senha do freshtech algumas vezes (e a do sudo uma vez).
set -euo pipefail
trap 'echo; read -p "Pressione Enter para fechar..."' EXIT

VPS_USER="freshtech"
VPS_HOST="179.197.233.72"
REMOTE_DIR="analiseacao"
DOMINIO="acoes.${VPS_HOST}.sslip.io"   # endereço grátis que aponta para o IP da VPS

cd "$(dirname "$0")/.."

echo "Chave da API da Anthropic (começa com sk-ant-). Crie em https://console.anthropic.com/settings/keys"
read -r -p "> " ANTHROPIC_KEY
[ -n "$ANTHROPIC_KEY" ] || { echo "❌ A chave é obrigatória."; exit 1; }

PG_SENHA="$(openssl rand -hex 24 2>/dev/null || (date +%s%N; echo $RANDOM$RANDOM) | sha256sum | cut -c1-48)"

echo "==> [1/4] Enviando o código..."
# Empacota só o que está commitado (sem node_modules, .env etc.).
git archive --format=tar.gz -o analiseacao.tar.gz HEAD
scp analiseacao.tar.gz "${VPS_USER}@${VPS_HOST}:~/"
rm -f analiseacao.tar.gz

echo "==> [2/4] Criando o .env.production (se ainda não existir)..."
# O conteúdo vai pela entrada padrão, para os segredos não aparecerem em linha de comando.
cat <<ENV | ssh "${VPS_USER}@${VPS_HOST}" "mkdir -p ~/${REMOTE_DIR} && find ~/${REMOTE_DIR} -mindepth 1 -maxdepth 1 ! -name .env.production -exec rm -rf {} + && tar xzf ~/analiseacao.tar.gz -C ~/${REMOTE_DIR} && rm ~/analiseacao.tar.gz && cd ~/${REMOTE_DIR} && if [ -f .env.production ] && ! grep -q troque_por_uma_senha_forte .env.production; then cat > /dev/null; echo '   já existe, mantido como está'; else umask 077; cat > .env.production; chmod 600 .env.production; echo '   criado'; fi"
TZ=America/Sao_Paulo
POSTGRES_USER=analiseacao
POSTGRES_PASSWORD=${PG_SENHA}
POSTGRES_DB=analiseacao
DATABASE_URL=postgres://analiseacao:${PG_SENHA}@postgres:5432/analiseacao
ANTHROPIC_API_KEY=${ANTHROPIC_KEY}
ANALISE_CRON=0 7 * * 1-5
ENV

echo "==> [3/4] Configurando o Nginx (vai pedir a senha do sudo)..."
ssh -t "${VPS_USER}@${VPS_HOST}" "sudo bash -c '
  sed \"s/SEU_SUBDOMINIO_AQUI/${DOMINIO}/\" ~${VPS_USER}/${REMOTE_DIR}/deploy/nginx.conf > /etc/nginx/sites-available/analiseacao &&
  ln -sf /etc/nginx/sites-available/analiseacao /etc/nginx/sites-enabled/analiseacao &&
  nginx -t && systemctl reload nginx &&
  (certbot --nginx -d ${DOMINIO} --non-interactive --agree-tos --register-unsafely-without-email --redirect \
     || echo \"   HTTPS não foi possível agora; o site funciona em http://${DOMINIO}\")
'"

echo "==> [4/4] Subindo banco, site e agendador (o primeiro build leva alguns minutos)..."
ssh "${VPS_USER}@${VPS_HOST}" "cd ~/${REMOTE_DIR} && docker compose -f docker-compose.prod.yml up -d --build && docker compose -f docker-compose.prod.yml ps"

echo
echo "✅ Pronto! Abra: https://${DOMINIO}  (ou http:// se o HTTPS não foi possível)"
echo "   Para rodar a primeira análise, clique em \"Rodar análise agora\" no site."
