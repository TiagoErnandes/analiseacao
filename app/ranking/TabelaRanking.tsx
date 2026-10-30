"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import type { Analise } from "@/lib/db";
import { brl, num, pct } from "@/lib/format";
import { Logo } from "../Logo";
import { TipoAtivo } from "../TipoAtivo";
import { Alertas, Nota, Score, Sinal, Variacao } from "../ui";

type Filtro = "todas" | "carteira" | "comprar" | "abaixo";
const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: "todas", rotulo: "Todas" },
  { id: "carteira", rotulo: "Na carteira" },
  { id: "comprar", rotulo: "Sinal Comprar" },
  { id: "abaixo", rotulo: "Abaixo do teto" },
];

type Coluna = { id: string; rotulo: string; valor: (a: Analise) => number | string | null; alinhar?: "right" | "center"; dica?: string };
const COLUNAS: Coluna[] = [
  { id: "preco", rotulo: "Cotação", valor: (a) => a.preco, alinhar: "right" },
  { id: "teto", rotulo: "Preço teto", valor: (a) => a.preco_teto, alinhar: "right", dica: "Bazin quando paga dividendos; senão Graham" },
  { id: "margem", rotulo: "Margem", valor: (a) => a.margem, alinhar: "right", dica: "Quanto o preço pode subir até o teto (negativo: está acima do teto)" },
  { id: "dy", rotulo: "DY 12m", valor: (a) => a.dy_12m, alinhar: "right" },
  { id: "pl", rotulo: "P/L", valor: (a) => (a.preco && a.lpa && a.lpa > 0 ? a.preco / a.lpa : null), alinhar: "right" },
  { id: "pvp", rotulo: "P/VP", valor: (a) => (a.preco && a.vpa && a.vpa > 0 ? a.preco / a.vpa : null), alinhar: "right" },
  { id: "roe", rotulo: "ROE", valor: (a) => a.roe, alinhar: "right" },
  { id: "qualidade", rotulo: "Qualidade", valor: (a) => a.qualidade, alinhar: "center", dica: "0 a 10, só com o balanço" },
  { id: "nota", rotulo: "Nota IA", valor: (a) => a.nota_ia, alinhar: "center" },
  { id: "score", rotulo: "Score", valor: (a) => a.score },
];

export function TabelaRanking({ analises, filtroInicial }: { analises: Analise[]; filtroInicial?: string }) {
  const [filtro, setFiltro] = useState<Filtro>(FILTROS.some((f) => f.id === filtroInicial) ? (filtroInicial as Filtro) : "todas");
  const [setor, setSetor] = useState("");
  const [tipo, setTipo] = useState("");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<{ col: string; desc: boolean }>({ col: "score", desc: true });
  const [aberto, setAberto] = useState<string | null>(null);

  const setores = useMemo(() => [...new Set(analises.map((a) => a.setor).filter(Boolean) as string[])].sort(), [analises]);

  const linhas = useMemo(() => {
    const col = COLUNAS.find((c) => c.id === ordem.col)!;
    const termo = busca.trim().toUpperCase();
    return analises
      .filter((a) =>
        filtro === "carteira" ? a.na_carteira : filtro === "comprar" ? a.recomendacao === "COMPRAR" : filtro === "abaixo" ? (a.margem ?? -1) > 0 : true,
      )
      .filter((a) => !setor || a.setor === setor)
      .filter((a) => !tipo || a.tipo === tipo)
      .filter((a) => !termo || a.ticker.includes(termo) || (a.nome ?? "").toUpperCase().includes(termo))
      .sort((x, y) => {
        const vx = col.valor(x) as number | null;
        const vy = col.valor(y) as number | null;
        if (vx == null) return 1;
        if (vy == null) return -1;
        return ordem.desc ? vy - vx : vx - vy;
      });
  }, [analises, filtro, setor, tipo, busca, ordem]);

  const fmt = (id: string, a: Analise) => {
    switch (id) {
      case "preco": return <><p>{brl(a.preco)}</p><p className="text-[11px]"><Variacao v={a.variacao_dia} casas={2} /></p></>;
      case "teto": return brl(a.preco_teto);
      case "margem": return <Variacao v={a.margem} />;
      case "dy": return pct(a.dy_12m);
      case "pl": case "pvp": return num(COLUNAS.find((c) => c.id === id)!.valor(a) as number | null);
      case "roe": return pct(a.roe);
      case "qualidade": return <Nota v={a.qualidade} />;
      case "nota": return <Nota v={a.nota_ia} />;
      case "score": return <Score v={a.score} />;
    }
  };

  return (
    <div className="cartao">
      <div className="flex flex-col gap-3 border-b border-borda p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <button key={f.id} onClick={() => setFiltro(f.id)} className={`chip ${filtro === f.id ? "chip-ativo" : ""}`}>
              {f.rotulo}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="campo">
            <option value="">Ações, FIIs e ETFs</option>
            <option value="acao">Só ações</option>
            <option value="fii">Só FIIs</option>
            <option value="etf">Só ETFs</option>
          </select>
          <select value={setor} onChange={(e) => setSetor(e.target.value)} className="campo min-w-0 flex-1 lg:w-52">
            <option value="">Todos os setores</option>
            {setores.map((s) => <option key={s}>{s}</option>)}
          </select>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar ação" className="campo w-36" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="tabela">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th>Ativo</th>
              {COLUNAS.map((c) => (
                <th key={c.id} className={c.alinhar === "right" ? "!text-right" : c.alinhar === "center" ? "!text-center" : ""} title={c.dica}>
                  <button
                    onClick={() => setOrdem((o) => ({ col: c.id, desc: o.col === c.id ? !o.desc : true }))}
                    className={`inline-flex items-center gap-1 hover:text-texto ${ordem.col === c.id ? "text-texto" : ""}`}
                  >
                    {c.rotulo}
                    <span className="text-[9px]">{ordem.col === c.id ? (ordem.desc ? "▼" : "▲") : ""}</span>
                  </button>
                </th>
              ))}
              <th>Sinal</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((a, i) => (
              <Fragment key={a.ticker}>
                <tr onClick={() => setAberto(aberto === a.ticker ? null : a.ticker)} className="cursor-pointer">
                  <td className="text-fraco">{i + 1}</td>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Logo ticker={a.ticker} src={a.logo} />
                      <div>
                        <p className="flex items-center gap-1.5 font-medium">
                          <Link href={`/acao/${a.ticker}`} onClick={(e) => e.stopPropagation()} className="hover:text-marca">{a.ticker}</Link>
                          <TipoAtivo tipo={a.tipo} />
                          {a.na_carteira && <span className="rounded bg-[#3987e5]/15 px-1 text-[10px] font-semibold text-[#6da7ec]">CARTEIRA</span>}
                          {a.garimpo && (
                            <span className="rounded bg-marca/15 px-1 text-[10px] font-semibold text-marca" title="Achado pelo garimpo automático: fora da sua carteira e da lista fixa">
                              GARIMPO
                            </span>
                          )}
                          {a.alertas && <span className="text-[11px] text-amber-300" title={a.alertas}>⚠</span>}
                        </p>
                        <p className="max-w-40 truncate text-[11px] text-fraco">{a.setor}</p>
                      </div>
                    </div>
                  </td>
                  {COLUNAS.map((c) => (
                    <td key={c.id} className={c.alinhar === "right" ? "text-right" : c.alinhar === "center" ? "text-center" : ""}>
                      {fmt(c.id, a)}
                    </td>
                  ))}
                  <td><Sinal r={a.recomendacao} /></td>
                </tr>
                {aberto === a.ticker && (
                  <tr className="!bg-painel2/40">
                    <td />
                    <td colSpan={COLUNAS.length + 2} className="!whitespace-normal">
                      <div className="grid gap-3 py-1 md:grid-cols-[2fr_1fr]">
                        <div className="space-y-1.5 text-sm">
                          <p className="text-texto">{a.resumo_ia ?? "Sem comentário da IA."}</p>
                          {a.riscos_ia && <p className="text-xs text-amber-300/80">Risco: {a.riscos_ia}</p>}
                          <Alertas txt={a.alertas} />
                        </div>
                        <div className="text-xs text-suave">
                          <p>Teto Bazin: {brl(a.teto_bazin)} · Teto Graham: {brl(a.teto_graham)}</p>
                          <p>DPA 12m: {brl(a.dpa_12m)} · Média 5 anos: {brl(a.dpa_medio)}</p>
                          <Link href={`/acao/${a.ticker}`} className="mt-2 inline-block text-marca hover:underline">Ver detalhes de {a.ticker} →</Link>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {linhas.length === 0 && <p className="p-8 text-center text-sm text-suave">Nenhuma ação com esses filtros.</p>}
      </div>
    </div>
  );
}
