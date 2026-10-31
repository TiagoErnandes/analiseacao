# Análise de Ações (previdência e buy and hold)

Todo dia útil às 7h o agendador:

1. Analisa **ações, fundos imobiliários (FIIs) e ETFs**. Busca preço e **histórico de 10 anos de dividendos** (Yahoo Finance) e **balanço** (Fundamentus: LPA, VPA, ROE, DY, P/L, P/VP, dívida, margem, liquidez, crescimento de receita e setor) da sua carteira, das ~30 maiores ações do Ibovespa, de 10 FIIs e 4 ETFs bem negociados. Nos FIIs também P/VP, FFO, vacância e segmento. Tudo gratuito.
2. Calcula o **preço teto**, de forma conservadora:
   - **Bazin**: o menor entre o dividendo dos últimos 12 meses e a média de 5 anos, ÷ o **yield exigido** (quando o DY é de pelo menos metade do yield exigido, ≈ 3,5% a 4,5%; abaixo disso a empresa reinveste o lucro e o teto vem do Graham).
   - **Yield exigido ligado ao juro**: acompanha o juro real do **Tesouro IPCA+** (mediana dos títulos de 5 anos ou mais, arquivo público do Tesouro Transparente; plano B: Selic descontada do IPCA de 12 meses, Banco Central). Ações: o juro real, entre 6% e 9%. FIIs: juro real + 1,5 ponto, entre 8% e 11%. Se o título público sem risco paga 7% acima da inflação, um dividendo de 6% não compensa o risco da ação. `lib/juros.ts`.
   - **Graham**: √(22,5 × LPA × VPA) (quando a empresa paga pouco dividendo).
   - **FIIs**: o menor entre o rendimento de 12 meses, o FFO por cota e a média de 5 anos, ÷ o yield exigido dos FIIs.
   - **ETFs**: Bazin se pagam dividendos; senão, a média de preço dos últimos 12 meses.
   - **Margem** = quanto o preço pode subir até o teto (teto ÷ preço − 1). Negativa = acima do teto (no máximo −100%).
   - Dados que não batem entre as fontes viram **alertas** (e são descartados do cálculo).
2b. **Garimpo (padrão previdência)**: todo dia, a tabela pública do Fundamentus com todas as empresas da bolsa é filtrada em busca de ações fora da sua lista com P/L entre 2 e 15, ROE ≥ 12%, DY entre 5% e 20%, dívida bruta ≤ 1,5× o patrimônio, patrimônio ≥ R$ 2 bi e liquidez ≥ R$ 5 mi/dia (as 20 melhores, uma classe por empresa), e de FIIs de tijolo (logística, shoppings, lajes, renda urbana etc.) com P/VP entre 0,75 e 1,05, DY entre 8% e 16%, vacância ≤ 10%, valor de mercado ≥ R$ 1 bi e liquidez ≥ R$ 1 mi/dia (os 2 melhores). Depois de buscar os dados, só fica quem passa no padrão previdência: ação com valor de mercado ≥ R$ 5 bi, setor não cíclico, lucro em todos os últimos 10 anos (mínimo 8 anos de balanço na CVM) e dividendo pago todo ano (no máximo 1 ano sem e 1 corte pela metade); FII com patrimônio ≥ R$ 1 bi e pelo menos 5 anos pagando rendimento todo ano. Os aprovados entram na análise do dia e aparecem com a etiqueta GARIMPO no ranking; os descartados aparecem no log com o motivo. `lib/garimpo.ts` e `lib/analise.ts`.
3. Dá uma **nota de qualidade** (0 a 10) só com o balanço: ROE, payout sustentável, dívida, margem, liquidez, crescimento e **constância em 10 anos**: lucro em todos os anos (balanços anuais da CVM, dados abertos), lucro crescendo e dividendo todo ano sem cortes pela metade.
   - **Fontes oficiais para a IA** (grátis): fatos relevantes, comunicados e avisos aos acionistas dos últimos 45 dias (CVM, dados abertos, baixados uma vez por dia) e proventos anunciados com data-com (B3). Um documento novo faz a IA olhar o ativo de novo. Tudo aparece na página de cada ação. `lib/cvm.ts`.
4. Mede o **peso de cada setor** na carteira. Setor acima de 30% não ganha bônus de "peso faltando" e recebe alerta.
5. A **IA é opcional e barata**. O modo é escolhido no painel, ao lado do botão "Rodar análise agora":
   - **Grátis (Gemini)** (padrão, sem custo): o Gemini 3.8 Flash (com 3.6 Flash e 3.5 Flash-Lite de reserva, se o Google desativar um modelo) dá nota e sinal a todos os ativos do ranking, com os números e os documentos oficiais da CVM e da B3. Não usa a Busca Google, que exige faturamento. Precisa de `GEMINI_API_KEY` de um projeto do Google **sem** faturamento. Se o Gemini falhar ou passar do limite, a análise segue só pelo cálculo, com as notas guardadas.
   - **Gemini com Busca Google** (pago, centavos): igual ao Grátis, mas antes o Gemini pesquisa as notícias do dia na Busca Google (uma vez por dia). Precisa de `GEMINI_API_KEY_PAGO` de um projeto **com** faturamento: os tokens são cobrados e 5.000 buscas por mês são grátis. O custo aparece no AI Studio, não no site.
   - **Só cálculo** (grátis): o app decide só pelo cálculo (preço teto, qualidade e score).
   - **Econômico** (≈ R$ 0,02 por análise): o Claude Haiku dá nota e sinal aos ativos da carteira e aos 8 melhores de fora, sem pesquisa na web.
   - **Completo** (≈ R$ 0,30 a 0,70): pesquisa de notícias na web e o Claude Sonnet toma a decisão final. A pesquisa do dia fica guardada e não é paga de novo se você rodar outra vez.
   - **Pesquisa de notícias com o Gemini (grátis)**: com `GEMINI_API_KEY_PAGO` (ou `GEMINI_API_KEY`) no `.env.production`, o Gemini com Busca Google pesquisa o cenário e as novidades de cada ativo, nos modos Econômico e Completo (precisa de faturamento ativo no Google; 5.000 buscas por mês sem custo, a análise usa 1 por dia). O Claude continua tomando a decisão. Se o Gemini falhar ou passar do limite, o Completo pesquisa com o Claude Haiku (até 5 buscas) e o Econômico segue sem notícias. No plano grátis, o Google pode usar o texto enviado (tickers e perguntas) para treinar modelos. Modelo trocável em `GEMINI_MODEL`.
   - **Só reanalisa o que mudou**: cada ativo guarda uma "assinatura" dos dados que a IA viu (balanço, dividendos, qualidade, alertas e a margem até o teto em faixas de 5 pontos). Se nada mudou, a nota anterior é reaproveitada (vale 7 dias no Econômico e 3 no Completo). Se nenhum ativo mudou, a IA nem é chamada. Tabela `cache_ia`.
   - **Batch API na análise das 7h**: a análise automática vai pela Batch API da Anthropic, que cobra metade do preço dos tokens. Se o lote não terminar em 60 minutos, ela é feita do jeito normal. O botão "Rodar análise agora" continua imediato.
   - **Dados guardados no banco** (tabela `cache_fontes`): o balanço do Fundamentus só é buscado de novo a cada 30 dias, ou a cada 3 dias quando já passaram 90 dias do último balanço (época de resultado); FIIs, por semana. O histórico de 6 anos do Yahoo é renovado por semana. Todo dia só o preço é buscado, e P/L, P/VP e DY são recalculados com ele.
   - Se a IA falhar (por exemplo, sem créditos), a análise termina mesmo assim, só pelo cálculo. O custo e a economia do mês aparecem no painel.
6. Salva tudo no Postgres. O site mostra o resultado:
   - **Painel**: patrimônio, rentabilidade, renda passiva e DY da carteira, ações do dia, cenário, simulador de aporte, alocação por setor e pontos de atenção.
   - **Ranking**: as ações analisadas com filtros, busca, ordenação por qualquer coluna e o comentário da IA.
   - **Carteira**: **registro de compras e vendas** (o preço médio é recalculado sozinho), histórico das operações, correção à mão ou **importação da B3** (arquivos de Posição e Negociação da Área do Investidor; o preço médio é calculado pelas negociações).
   - **Busca e índices no topo**: busca de ativos (atalho `/`), inclusive os que não estão na sua lista: a página do ativo faz a análise na hora (mesmo cálculo de preço teto e qualidade, sem IA, guardada 6 horas, sem entrar no ranking) e tem o botão "Acompanhar na análise diária" (tabela `universo`) e faixa com Ibovespa, dólar, euro, S&P 500, Nasdaq e Bitcoin (Yahoo, atualiza a cada 5 minutos).
   - **Gráfico de cotação** na página de cada ativo: períodos 1D, 5D, 1M, 6M, no ano, 1A, 5A e máximo, com linhas do preço teto e do seu preço médio, mínima e máxima do período e faixa de 52 semanas (Yahoo, guardado alguns minutos na memória). `lib/cotacao.ts`.
   - **Página de cada ação**: preço teto (Bazin e Graham), indicadores, análise da IA, lucro de cada ano, dividendos em 10 anos, fatos relevantes e proventos anunciados, sua posição e o histórico de cotação × preço teto.
   - **Placar**: as recomendações passadas deram certo? Para cada sinal (Ação do dia, COMPRAR e EVITAR, um por ativo e por mês), o retorno com proventos até hoje e depois de 3, 6 e 12 meses, comparado com o Ibovespa no mesmo período.

Score do ranking: 35% qualidade, 25% nota da IA e 40% desconto ao teto (no Balanceamento, 30% desconto e 10% quanto falta para o peso ideal). O desconto conta até 40% abaixo do teto. Sem nota da IA, os outros pesos são reescalados.

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

## Alertas de venda

O agendador vigia os ativos da carteira (ações e FIIs) a cada 30 minutos, das 7h às 22h, todos os dias:
- **Notícias** das últimas 24 horas no Google Notícias. O Gemini (chave grátis) separa em VENDER (fato que pode destruir a tese: fraude, recuperação judicial, corte de dividendos, intervenção...), ATENÇÃO ou nada. Sem Gemini, a triagem é por palavras-chave.
- **Fatos relevantes e comunicados** novos na CVM.
- **Queda de 7% ou mais** no dia (pede uma olhada, não é venda).
- **Análise do dia**: ativo da carteira que passa para EVITAR.

Cada alerta é enviado uma vez só, no Telegram (`TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`) e/ou no app ntfy (`NTFY_TOPICO`), e aparece no painel ("Alertas da carteira", com botão para testar o envio).

