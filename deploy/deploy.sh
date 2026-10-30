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

# Não reinicia o servidor no meio de uma análise (ela seria interrompida). FORCAR=1 ignora a checagem.
if [ -z "${FORCAR:-}" ]; then
  RODANDO="$(ssh "${VPS_USER}@${VPS_HOST}" bash -s <<'REMOTO' 2>/dev/null || true
docker exec analiseacao_postgres sh -c 'psql -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}" -tAc "select count(*) from execucoes where status = '"'"'rodando'"'"' and coalesce(batida, inicio) > now() - interval '"'"'3 minutes'"'"'"' 2>/dev/null
REMOTO
)"
  if [ "${RODANDO//[^0-9]/}" != "" ] && [ "${RODANDO//[^0-9]/}" != "0" ]; then
    echo "⏳ Tem uma análise rodando na VPS. O deploy fica para depois, para não interrompê-la."
    exit 3
  fi
fi

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
   docker compose -f docker-compose.prod.yml build && \
   { docker compose -f docker-compose.prod.yml up -d || { \
       echo '==> Removendo containers velhos que travaram a troca e tentando de novo...'; \
       docker ps -aq --filter name=_analiseacao_ | xargs -r docker rm -f; \
       docker rm -f analiseacao_web analiseacao_agendador >/dev/null 2>&1; \
       docker compose -f docker-compose.prod.yml up -d; }; }"

rm -f analiseacao.tar.gz
echo "✅ App atualizado."
