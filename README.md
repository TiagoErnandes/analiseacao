# Análise de Ações (previdência e buy and hold)

Todo dia útil às 7h um robô:

1. Busca preço e **histórico de 5 anos de dividendos** (Yahoo Finance) e **LPA, VPA e ROE** (Fundamentus) da sua carteira e das ~30 maiores do Ibovespa. Tudo gratuito.
2. Calcula o **preço teto**:
   - **Bazin**: dividendo médio anual ÷ 6% (usado quando a empresa paga dividendos).
   - **Graham**: √(22,5 × LPA × VPA) (usado quando não paga).
   - **Margem** = quanto o preço está abaixo do teto.
3. Pede ao **Claude** para pesquisar na web notícias e resultados recentes, dar nota (0 a 10) e sinal (Comprar / Aguardar / Evitar) a cada ação e escolher a **ação do dia** (na sua carteira e no geral).
4. Salva tudo no Supabase. O site mostra o resultado.

Nota final do ranking: 50% desconto ao teto, 35% nota da IA, 15% quanto falta para o peso ideal na carteira (pesos iguais).

## Como colocar no ar (uns 20 minutos)

### 1. Supabase (banco, grátis)
1. Crie um projeto em https://supabase.com.
2. Abra **SQL Editor**, cole o conteúdo de `supabase/schema.sql` e clique em **Run**. Isso cria as tabelas, sua carteira e a lista das 30.
3. Em **Project Settings > API**, copie a **Project URL** e a **service_role key**.

### 2. Anthropic (IA)
Crie uma chave em https://console.anthropic.com e coloque crédito. A análise diária faz duas chamadas (pesquisa na web + decisão); acompanhe o custo no console nos primeiros dias.

### 3. GitHub (robô das 7h)
No repositório: **Settings > Secrets and variables > Actions > New repository secret**, crie:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`.

Para testar na hora: aba **Actions > Análise diária > Run workflow**.

### 4. Vercel (site, grátis)
1. Em https://vercel.com, **Add New > Project** e importe este repositório.
2. Em **Environment Variables** coloque `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `APP_PASSWORD` (a senha para abrir o site).
3. Deploy. Ao abrir, o navegador pede usuário (qualquer um) e a senha.

## Rodar no seu computador
```bash
cp .env.example .env.local   # preencha
npm install
npm run dev                  # site em http://localhost:3000
npx tsx --env-file=.env.local scripts/daily.ts   # roda a análise na hora
```

## Ajustes
- **Lista das 30**: tabela `universo` no Supabase (coluna `ativo`).
- **Yield mínimo do Bazin** (6%): `lib/valuation.ts`.
- **Pesos da nota final**: `scoreFinal` em `lib/valuation.ts`.
- **Instruções da IA**: `lib/ai.ts`.

> Ferramenta de apoio à decisão. Não é recomendação de investimento.
