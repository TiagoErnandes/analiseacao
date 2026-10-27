# Análise de Ações (previdência e buy and hold)

Todo dia útil às 7h o agendador:

1. Busca preço e **histórico de 5 anos de dividendos** (Yahoo Finance) e **LPA, VPA e ROE** (Fundamentus) da sua carteira e das ~30 maiores do Ibovespa. Tudo gratuito.
2. Calcula o **preço teto**:
   - **Bazin**: dividendo médio anual ÷ 6% (usado quando a empresa paga dividendos).
   - **Graham**: √(22,5 × LPA × VPA) (usado quando não paga).
   - **Margem** = quanto o preço está abaixo do teto.
3. Pede ao **Claude** para pesquisar na web notícias e resultados recentes, dar nota (0 a 10) e sinal (Comprar / Aguardar / Evitar) a cada ação e escolher a **ação do dia** (na sua carteira e no geral).
4. Salva tudo no Postgres. O site mostra o resultado.

Nota final do ranking: 50% desconto ao teto, 35% nota da IA, 15% quanto falta para o peso ideal na carteira (pesos iguais).

## Como colocar no ar

Roda na VPS da Hostinger, ao lado do Fresh Tech, com Docker Compose (Postgres + site + agendador das 7h).
Passo a passo em [DEPLOY.md](DEPLOY.md).

## Rodar no seu computador
```bash
cp .env.example .env.local   # coloque sua ANTHROPIC_API_KEY
docker compose up -d         # Postgres local na porta 5434, já com as tabelas
npm install
npm run dev                  # site em http://localhost:3000
npx tsx --env-file=.env.local scripts/analise.ts   # roda a análise na hora
```

## Ajustes
- **Lista das 30**: tabela `universo` no banco (coluna `ativo`).
- **Horário da análise**: `ANALISE_CRON` no `.env.production`.
- **Yield mínimo do Bazin** (6%): `lib/valuation.ts`.
- **Pesos da nota final**: `scoreFinal` em `lib/valuation.ts`.
- **Instruções da IA**: `lib/ai.ts`.

> Ferramenta de apoio à decisão. Não é recomendação de investimento.
