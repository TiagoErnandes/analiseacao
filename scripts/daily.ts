// Roda toda manhã (GitHub Actions) ou na mão: `npm run analise`.
import { analisarComIa, type LinhaParaIa } from "../lib/ai";
import { buscarAcao, type DadosAcao } from "../lib/mercado";
import { db, type Carteira } from "../lib/supabase";
import { calcularDpa, margem, precoTeto, scoreFinal, tetoBazin, tetoGraham } from "../lib/valuation";

function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

async function main() {
  const supa = db();
  const hoje = hojeSaoPaulo();

  const [{ data: carteira, error: e1 }, { data: universo, error: e2 }] = await Promise.all([
    supa.from("carteira").select("ticker, quantidade, preco_medio"),
    supa.from("universo").select("ticker").eq("ativo", true),
  ]);
  if (e1 || e2) throw e1 ?? e2;

  const minha = new Map((carteira as Carteira[]).map((c) => [c.ticker.toUpperCase(), c]));
  const tickers = [...new Set([...minha.keys(), ...(universo ?? []).map((u) => u.ticker.toUpperCase())])];
  console.log(`Analisando ${tickers.length} ações em ${hoje}`);

  // 1) Dados de mercado (em sequência, para não sobrecarregar as fontes)
  const dados: DadosAcao[] = [];
  for (const t of tickers) {
    try {
      dados.push(await buscarAcao(t));
    } catch (err) {
      console.warn(`  pulando ${t}: ${(err as Error).message}`);
    }
  }
  if (dados.length === 0) throw new Error("Nenhum dado de mercado obtido. Yahoo/Fundamentus podem estar fora do ar.");

  // 2) Preço teto e pesos da carteira
  const totalCarteira = dados.reduce((s, d) => s + (minha.get(d.ticker)?.quantidade ?? 0) * (d.preco ?? 0), 0);
  const pesoIdeal = minha.size > 0 ? 1 / minha.size : 0;

  const linhas: (LinhaParaIa & { logo: string | null; variacao_dia: number | null; dpa_12m: number | null })[] =
    dados.map((d) => {
      const { dpa12m, dpaMedio } = calcularDpa(d.proventos);
      const bazin = tetoBazin(dpaMedio);
      const graham = tetoGraham(d.lpa, d.vpa);
      const teto = precoTeto(bazin, graham);
      const pos = minha.get(d.ticker);
      return {
        ticker: d.ticker,
        nome: d.nome,
        logo: d.logo,
        variacao_dia: d.variacaoDia,
        na_carteira: !!pos,
        peso_atual: pos && totalCarteira > 0 ? (pos.quantidade * (d.preco ?? 0)) / totalCarteira : null,
        preco: d.preco,
        lpa: d.lpa,
        vpa: d.vpa,
        dpa_12m: dpa12m,
        dy_12m: dpa12m && d.preco ? dpa12m / d.preco : null,
        dpa_medio: dpaMedio,
        roe: d.roe,
        teto_bazin: bazin,
        teto_graham: graham,
        preco_teto: teto,
        margem: margem(d.preco, teto),
      };
    });

  // 3) IA: pesquisa de notícias + nota por ação + ação do dia
  const ia = await analisarComIa(
    linhas.map(({ logo, variacao_dia, dpa_12m, ...resto }) => resto),
    hoje,
  );
  const porTicker = new Map(ia.acoes.map((a) => [a.ticker.toUpperCase(), a]));

  // 4) Salva
  const registros = linhas.map((l) => {
    const a = porTicker.get(l.ticker);
    const falta = l.na_carteira && l.peso_atual != null ? pesoIdeal - l.peso_atual : null;
    return {
      data: hoje,
      ticker: l.ticker,
      nome: l.nome,
      logo: l.logo,
      preco: l.preco,
      variacao_dia: l.variacao_dia,
      lpa: l.lpa,
      vpa: l.vpa,
      dpa_12m: l.dpa_12m,
      dpa_medio: l.dpa_medio,
      dy_12m: l.dy_12m,
      roe: l.roe,
      teto_bazin: l.teto_bazin,
      teto_graham: l.teto_graham,
      preco_teto: l.preco_teto,
      margem: l.margem,
      nota_ia: a?.nota ?? null,
      recomendacao: a?.recomendacao ?? null,
      resumo_ia: a?.resumo ?? null,
      riscos_ia: a?.riscos ?? null,
      score: scoreFinal({ margem: l.margem, notaIa: a?.nota ?? null, faltaParaIdeal: falta }),
      na_carteira: l.na_carteira,
    };
  });

  const { error: e3 } = await supa.from("analises").upsert(registros, { onConflict: "data,ticker" });
  if (e3) throw e3;

  const { error: e4 } = await supa.from("relatorio_diario").upsert({
    data: hoje,
    contexto_mercado: ia.contexto_mercado,
    acao_do_dia_carteira: ia.acao_do_dia_carteira.toUpperCase(),
    justificativa_carteira: ia.justificativa_carteira,
    acao_do_dia_geral: ia.acao_do_dia_geral.toUpperCase(),
    justificativa_geral: ia.justificativa_geral,
  });
  if (e4) throw e4;

  console.log(`Pronto. Ação do dia (carteira): ${ia.acao_do_dia_carteira} | (geral): ${ia.acao_do_dia_geral}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
