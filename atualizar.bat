@echo off
rem Atualiza o site sozinho: confere o GitHub a cada 5 minutos e, se tiver novidade, faz o pull e o deploy.
rem Duplo clique para deixar vigiando. Para atualizar so uma vez: atualizar.bat agora
chcp 65001 >nul
title Analise de acoes - atualizacao automatica
set "GITBASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%GITBASH%" set "GITBASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not exist "%GITBASH%" set "GITBASH=%LocalAppData%\Programs\Git\bin\bash.exe"
if not exist "%GITBASH%" (
  echo Nao achei o Git Bash. Instale o Git para Windows: https://git-scm.com/download/win
  pause
  exit /b 1
)
cd /d "%~dp0"
"%GITBASH%" deploy/vigiar.sh %*
pause
