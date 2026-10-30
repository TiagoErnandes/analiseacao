# Análise de Ações (previdência e buy and hold)

Todo dia útil às 7h o agendador:

1. Analisa **ações, fundos imobiliários (FIIs) e ETFs**. Busca preço e **histórico de 10 anos de dividendos** (Yahoo Finance) e **balanço** (Fundamentus: LPA, VPA, ROE, DY, P/L, P/VP, dívida, margem, liquidez, crescimento de receita e setor) da sua carteira, das ~30 maiores ações do Ibovespa, de 10 FIIs e 4 ETFs bem negociados. Nos FIIs também P/VP, FFO, vacância e segmento. Tudo gratuito.
2. Calcula o **preço teto**, de forma conservadora:
   - **Bazin**: o menor entre o dividendo dos últimos 12 meses e a média de 5 anos, ÷ o **yield exigido** (quando o DY passa de 2%).
   - **Yield exigido ligado ao juro**: acompanha o juro real do **Tesouro IPCA+** (mediana dos títulos de 5 anos ou mais, arquivo público do Tesouro Transparente; plano B: Selic descontada do IPCA de 12 meses, Banco Central). Ações: o juro real, entre 6% e 9%. FIIs: juro real + 1,5 ponto, entre 8% e 11%. Se o título público sem risco paga 7% acima da inflação, um dividendo de 6% não compensa o risco da ação. `lib/juros.ts`.
   - **Graham**: √(22,5 × LPA × VPA) (quando a empresa paga pouco dividendo).
   - **FIIs**: o menor entre o rendimento de 12 meses, o FFO por cota e a média de 5 anos, ÷ o yield exigido dos FIIs.
   - **ETFs**: Bazin se pagam dividendos; senão, a média de preço dos últimos 12 meses.
   - **Margem** = quanto o preço está abaixo do teto.
   - Dados que não batem entre as fontes viram **alertas** (e são descartados do cálculo).
3. Dá uma **nota de qualidade** (0 a 10) só com o balanço: ROE, payout sustentável, dívida, margem, liquidez, crescimento e **constância em 10 anos**: lucro em todos os anos (balanços anuais da CVM, dados abertos), lucro crescendo e dividendo todo ano sem cortes pela metade.
   - **Fontes oficiais para a IA** (grátis): fatos relevantes, comunicados e avisos aos acionistas dos últimos 45 dias (CVM, dados abertos, baixados uma vez por dia) e proventos anunciados com data-com (B3). Um documento novo faz a IA olhar o ativo de novo. Tudo aparece na página de cada ação. `lib/cvm.ts`.
4. Mede o **peso de cada setor** na carteira. Setor acima de 30% não ganha bônus de "peso faltando" e recebe alerta.
5. A **IA é opcional e barata**. O modo é escolhido no painel, ao lado do botão "Rodar análise agora":
   - **Grátis (Gemini)** (padrão, sem custo): o Gemini 2.5 Flash pesquisa as notícias do dia na Busca Google e dá nota e sinal aos ativos da carteira e aos 8 melhores de fora. Usa o plano grátis do Google (precisa de `GEMINI_API_KEY`). Se o Gemini falhar ou passar do limite, a análise segue só pelo cálculo, com as notas guardadas.
   - **Só cálculo** (grátis): o app decide só pelo cálculo (preço teto, qualidade e score).
   - **Econômico** (≈ R$ 0,02 por análise): o Claude Haiku dá nota e sinal aos ativos da carteira e aos 8 melhores de fora, sem pesquisa na web.
   - **Completo** (≈ R$ 0,30 a 0,70): pesquisa de notícias na web e o Claude Sonnet toma a decisão final. A pesquisa do dia fica guardada e não é paga de novo se você rodar outra vez.
   - **Pesquisa de notícias com o Gemini (grátis)**: com `GEMINI_API_KEY` no `.env.production`, o Gemini 2.5 Flash com Busca Google pesquisa o cenário e as novidades de cada ativo, nos modos Econômico e Completo (o plano grátis permite 500 por dia; a análise usa 1). O Claude continua tomando a decisão. Se o Gemini falhar ou passar do limite, o Completo pesquisa com o Claude Haiku (até 5 buscas) e o Econômico segue sem notícias. No plano grátis, o Google pode usar o texto enviado (tickers e perguntas) para treinar modelos. Modelo trocável em `GEMINI_MODEL`.
   - **Só reanalisa o que mudou**: cada ativo guarda uma "assinatura" dos dados que a IA viu (balanço, dividendos, qualidade, alertas e a margem até o teto em faixas de 5 pontos). Se nada mudou, a nota anterior é reaproveitada (vale 7 dias no Econômico e 3 no Completo). Se nenhum ativo mudou, a IA nem é chamada. Tabela `cache_ia`.
   - **Batch API na análise das 7h**: a análise automática vai pela Batch API da Anthropic, que cobra metade do preço dos tokens. Se o lote não terminar em 60 minutos, ela é feita do jeito normal. O botão "Rodar análise agora" continua imediato.
   - **Dados guardados no banco** (tabela `cache_fontes`): o balanço do Fundamentus só é buscado de novo a cada 30 dias, ou a cada 3 dias quando já passaram 90 dias do último balanço (época de resultado); FIIs, por semana. O histórico de 6 anos do Yahoo é renovado por semana. Todo dia só o preço é buscado, e P/L, P/VP e DY são recalculados com ele.
   - Se a IA falhar (por exemplo, sem créditos), a análise termina mesmo assim, só pelo cálculo. O custo e a economia do mês aparecem no painel.
6. Salva tudo no Postgres. O site mostra o resultado:
   - **Painel**: patrimônio, rentabilidade, renda passiva e DY da carteira, ações do dia, cenário, simulador de aporte, alocação por setor e pontos de atenção.
   - **Ranking**: as ações analisadas com filtros, busca, ordenação por qualquer coluna e o comentário da IA.
   - **Carteira**: **registro de compras e vendas** (o preço médio é recalculado sozinho), histórico das operações, correção à mão ou **importação da B3** (arquivos de Posição e Negociação da Área do Investidor; o preço médio é calculado pelas negociações).
   - **Página de cada ação**: preço teto (Bazin e Graham), indicadores, análise da IA, lucro de cada ano, dividendos em 10 anos, fatos relevantes e proventos anunciados, sua posição e o histórico de cotação × preço teto.
   - **Placar**: as recomendações passadas deram certo? Para cada sinal (Ação do dia, COMPRAR e EVITAR, um por ativo e por mês), o retorno com proventos até hoje e depois de 3, 6 e 12 meses, comparado com o Ibovespa no mesmo período.

Score do ranking: 40% desconto ao teto, 25% qualidade, 25% nota da IA, 10% quanto falta para o peso ideal na carteira (pesos iguais). Sem nota da IA, os outros três pesos são reescalados.

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
- **Yield exigido do Bazin** (juro real, entre 6% e 9%; FIIs entre 8% e 11%): `yieldExigido` em `lib/juros.ts`.
- **Pesos da nota final**: `scoreFinal` em `lib/valuation.ts`.
- **Instruções da IA**: `lib/ai.ts`.
- **Estratégia da carteira** (seletor no painel): *Oportunidade* prioriza as ações mais baratas e de boa qualidade, sem buscar o peso ideal e sem limite por setor; *Balanceamento* completa o peso ideal e segura setores acima de 30%. No *Automático*, vale Oportunidade nos primeiros 12 meses a partir da primeira compra lançada (`config.inicio_carteira`) e depois Balanceamento. Limites e prazo em `lib/modos.ts`.

> Ferramenta de apoio à decisão. Não é recomendação de investimento.
