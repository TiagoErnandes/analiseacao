#!/usr/bin/env bash
# Fica de olho no GitHub: quando a main tiver atualização, faz o git pull e o deploy na VPS.
# Uso (Git Bash, na raiz do repo):
#   bash deploy/vigiar.sh          -> fica rodando e confere a cada 5 minutos
#   bash deploy/vigiar.sh agora    -> faz o pull e o deploy uma vez e termina
# Para mudar o intervalo: INTERVALO=120 bash deploy/vigiar.sh   (em segundos)
set -uo pipefail
cd "$(dirname "$0")/.."

INTERVALO="${INTERVALO:-300}"
MODO="${1:-vigiar}"
VPS="freshtech@179.197.233.72"
ULTIMO=".ultimo-deploy" # commit que já está na VPS (fica só no seu PC)
export DEPLOY_SEM_PAUSA=1

agora() { date "+%d/%m/%Y %H:%M:%S"; }

# O deploy roda sem ninguém olhando, então a VPS não pode pedir senha: usa uma chave SSH.
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$VPS" true 2>/dev/null; then
  echo "A VPS ainda pede senha. Vou criar uma chave SSH para o deploy automático (só desta vez)."
  [ -f ~/.ssh/id_ed25519 ] || ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 -q
  echo "Digite a senha da VPS uma última vez:"
  ssh "$VPS" "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys" < ~/.ssh/id_ed25519.pub \
    || { echo "❌ Não consegui instalar a chave na VPS."; exit 1; }
  echo "✅ Chave instalada. Daqui pra frente o deploy não pede senha."
fi

atualizar() {
  if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
    echo "[$(agora)] ⚠️  O repositório não está na main. Rode: git checkout main"
    return 1
  fi
  if ! git fetch -q origin main; then
    echo "[$(agora)] ⚠️  Sem conexão com o GitHub. Tento de novo depois."
    return 1
  fi
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    echo "[$(agora)] Atualização nova no GitHub:"
    git log --oneline HEAD..origin/main | sed 's/^/    /'
    if ! git pull -q --ff-only origin main; then
      echo "[$(agora)] ❌ O git pull falhou (tem alteração local?). Resolva e o vigia tenta de novo."
      return 1
    fi
  fi
  local atual
  atual="$(git rev-parse HEAD)"
  if [ "$MODO" != "agora" ] && [ "$(cat "$ULTIMO" 2>/dev/null)" = "$atual" ]; then
    return 0 # a VPS já está com esta versão
  fi
  echo "[$(agora)] Subindo $(git log -1 --format='%h %s') para a VPS..."
  bash deploy/deploy.sh
  local r=$?
  if [ $r -eq 0 ]; then
    echo "$atual" > "$ULTIMO"
    echo "[$(agora)] ✅ Deploy feito."
  elif [ $r -eq 3 ]; then
    echo "[$(agora)] ⏳ Esperando a análise terminar. Tento de novo na próxima conferida."
    return 1
  else
    echo "[$(agora)] ❌ O deploy falhou. Tento de novo na próxima conferida."
    return 1
  fi
}

if [ "$MODO" = "agora" ]; then
  atualizar
  exit $?
fi

echo "[$(agora)] Vigiando o GitHub a cada $((INTERVALO / 60)) min. Deixe esta janela aberta (Ctrl+C para parar)."
while true; do
  atualizar
  sleep "$INTERVALO"
done
