import { brl, dataBr, pct } from "@/lib/format";
import { db, type Analise, type Carteira, type Relatorio } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function carregar() {
  const supa = db();
  const { data: rel } = await supa
    .from("relatorio_diario")
    .select("*")
    .order("data", { ascending: false })
    .limit(1)
    .maybeSingle<Relatorio>();
  const { data: carteira } = await supa.from("carteira").select("ticker, quantidade, preco_medio");
  if (!rel) return { rel: null, analises: [] as Analise[], carteira: (carteira ?? []) as Carteira[] };
  const { data: analises } = await supa.from("analises").select("*").eq("data", rel.data);
  return { rel, analises: (analises ?? []) as Analise[], carteira: (carteira ?? []) as Carteira[] };
}

function Rec({ r }: { r: string | null }) {
  const estilo =
    r === "COMPRAR"
      ? "bg-emerald-500/15 text-emerald-400"
      : r === "EVITAR"
        ? "bg-red-500/15 text-red-400"
        : "bg-neutral-700/40 text-neutral-300";
  const txt = r === "COMPRAR" ? "Comprar" : r === "EVITAR" ? "Evitar" : r === "AGUARDAR" ? "Aguardar" : "—";
  return <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${estilo}`}>{txt}</span>;
}

function Margem({ v }: { v: number | null }) {
  if (v == null) return <span className="text-neutral-500">—</span>;
  return <span className={v >= 0 ? "text-emerald-400" : "text-red-400"}>{pct(v)}</span>;
}

function Logo({ a }: { a: Pick<Analise, "logo" | "ticker"> }) {
  return a.logo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={a.logo} alt="" className="h-6 w-6 rounded" />
  ) : (
    <span className="inline-block h-6 w-6 rounded bg-neutral-800" />
  );
}

function CardDoDia({ titulo, a, justificativa }: { titulo: string; a?: Analise; justificativa: string | null }) {
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
      <p className="text-xs uppercase tracking-wide text-emerald-400">{titulo}</p>
      {a ? (
        <>
          <div className="mt-2 flex items-center gap-3">
            <Logo a={a} />
            <span className="text-2xl font-semibold">{a.ticker}</span>
            <Rec r={a.recomendacao} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <div><p className="text-neutral-400">Preço</p><p>{brl(a.preco)}</p></div>
            <div><p className="text-neutral-400">Preço teto</p><p>{brl(a.preco_teto)}</p></div>
            <div><p className="text-neutral-400">Margem</p><p><Margem v={a.margem} /></p></div>
          </div>
        </>
      ) : (
        <p className="mt-2 text-neutral-400">—</p>
      )}
      {justificativa && <p className="mt-3 text-sm text-neutral-300">{justificativa}</p>}
    </div>
  );
}

export default async function Home() {
  const { rel, analises, carteira } = await carregar();

  if (!rel) {
    return (
      <div className="rounded-xl border border-neutral-800 p-8 text-center text-neutral-400">
        Ainda não há análise. Ela roda automaticamente às 7h em dias úteis, ou rode agora com{" "}
        <code className="text-neutral-200">npm run analise</code> / botão &quot;Run workflow&quot; no GitHub Actions.
      </div>
    );
  }

  const porTicker = new Map(analises.map((a) => [a.ticker, a]));
  const total = carteira.reduce((s, c) => s + c.quantidade * (porTicker.get(c.ticker)?.preco ?? 0), 0);
  const pesoIdeal = carteira.length ? 1 / carteira.length : 0;
  const minha = carteira
    .map((c) => ({ c, a: porTicker.get(c.ticker) }))
    .sort((x, y) => (y.a?.score ?? -1) - (x.a?.score ?? -1));
  const ranking = [...analises].sort((x, y) => (y.score ?? -1) - (x.score ?? -1));

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-xl font-semibold">Análise de {dataBr(rel.data)}</h1>
        {rel.contexto_mercado && <p className="mt-2 max-w-3xl text-sm text-neutral-300">{rel.contexto_mercado}</p>}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <CardDoDia
          titulo="Ação do dia na sua carteira"
          a={porTicker.get(rel.acao_do_dia_carteira ?? "")}
          justificativa={rel.justificativa_carteira}
        />
        <CardDoDia
          titulo="Ação do dia entre as 30 do Ibovespa"
          a={porTicker.get(rel.acao_do_dia_geral ?? "")}
          justificativa={rel.justificativa_geral}
        />
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Minha carteira <span className="text-sm font-normal text-neutral-400">· {brl(total)}</span></h2>
        <div className="overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-neutral-400">
              <tr>
                {["Ativo", "Qtd.", "Preço médio", "Preço atual", "Rentab.", "% Carteira", "% Ideal", "Preço teto", "Margem", "Nota IA", "Comprar?"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {minha.map(({ c, a }) => {
                const peso = total > 0 && a?.preco ? (c.quantidade * a.preco) / total : null;
                const rent = a?.preco && c.preco_medio ? a.preco / c.preco_medio - 1 : null;
                return (
                  <tr key={c.ticker} className="border-t border-neutral-800">
                    <td className="px-3 py-2"><div className="flex items-center gap-2">{a && <Logo a={a} />}{c.ticker}</div></td>
                    <td className="px-3 py-2">{c.quantidade}</td>
                    <td className="px-3 py-2">{brl(c.preco_medio)}</td>
                    <td className="px-3 py-2">{brl(a?.preco)}</td>
                    <td className="px-3 py-2"><Margem v={rent} /></td>
                    <td className="px-3 py-2">{pct(peso)}</td>
                    <td className="px-3 py-2">{pct(pesoIdeal)}</td>
                    <td className="px-3 py-2">{brl(a?.preco_teto)}</td>
                    <td className="px-3 py-2"><Margem v={a?.margem ?? null} /></td>
                    <td className="px-3 py-2">{a?.nota_ia ?? "—"}</td>
                    <td className="px-3 py-2"><Rec r={a?.recomendacao ?? null} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-1 font-semibold">Ranking do dia</h2>
        <p className="mb-3 text-xs text-neutral-400">
          Preço teto = Bazin (dividendo médio ÷ 6%) quando a empresa paga dividendos; senão Graham (√22,5 × LPA × VPA).
          Ordenado pela nota final: 50% desconto, 35% nota da IA, 15% peso faltando na carteira.
        </p>
        <div className="overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-neutral-400">
              <tr>
                {["#", "Ativo", "Preço", "Teto Bazin", "Teto Graham", "Margem", "DY 12m", "Nota IA", "Score", "Sinal", "Por quê"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranking.map((a, i) => (
                <tr key={a.ticker} className="border-t border-neutral-800 align-top">
                  <td className="px-3 py-2 text-neutral-500">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Logo a={a} />
                      <span>{a.ticker}</span>
                      {a.na_carteira && <span className="whitespace-nowrap text-xs text-sky-400">● carteira</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2">{brl(a.preco)}</td>
                  <td className="px-3 py-2">{brl(a.teto_bazin)}</td>
                  <td className="px-3 py-2">{brl(a.teto_graham)}</td>
                  <td className="px-3 py-2"><Margem v={a.margem} /></td>
                  <td className="px-3 py-2">{pct(a.dy_12m)}</td>
                  <td className="px-3 py-2">{a.nota_ia ?? "—"}</td>
                  <td className="px-3 py-2 font-medium">{a.score ?? "—"}</td>
                  <td className="px-3 py-2"><Rec r={a.recomendacao} /></td>
                  <td className="min-w-72 px-3 py-2 text-neutral-300">
                    {a.resumo_ia}
                    {a.riscos_ia && <p className="mt-1 text-xs text-amber-400/80">Risco: {a.riscos_ia}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
