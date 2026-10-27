# Análise de Ações (previdência e buy and hold)

Todo dia útil às 7h o agendador:

1. Busca preço e **histórico de 5 anos de dividendos** (Yahoo Finance) e **balanço** (Fundamentus: LPA, VPA, ROE, DY, P/L, P/VP, dívida, margem, liquidez, crescimento de receita e setor) da sua carteira e das ~30 maiores do Ibovespa. Tudo gratuito.
2. Calcula o **preço teto**, de forma conservadora:
   - **Bazin**: o menor entre o dividendo dos últimos 12 meses e a média de 5 anos, ÷ 6% (quando o DY passa de 2%).
   - **Graham**: √(22,5 × LPA × VPA) (quando a empresa paga pouco dividendo).
   - **Margem** = quanto o preço está abaixo do teto.
   - Dados que não batem entre as fontes viram **alertas** (e são descartados do cálculo).
3. Dá uma **nota de qualidade** (0 a 10) só com o balanço: ROE, payout sustentável, dívida, margem, liquidez e crescimento.
4. Mede o **peso de cada setor** na carteira. Setor acima de 30% não ganha bônus de "peso faltando" e recebe alerta.
5. O **Claude** trabalha em 3 etapas (leva de 20 a 40 minutos; a prioridade é acertar):
   1. **Pesquisa** na web: último resultado trimestral, proventos, fatos relevantes, recomendações e cenário, com fonte e data.
   2. **Decisão**: nota (0 a 10) e sinal (Comprar / Aguardar / Evitar) para cada ação, e a **ação do dia** (na carteira e no geral).
   3. **Revisão**: confere a decisão contra os números e a pesquisa e corrige o que não bater. O site mostra o que foi revisado.
6. Salva tudo no Postgres. O site mostra o resultado.

Score do ranking: 40% desconto ao teto, 25% qualidade, 25% nota da IA, 10% quanto falta para o peso ideal na carteira (pesos iguais).

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
