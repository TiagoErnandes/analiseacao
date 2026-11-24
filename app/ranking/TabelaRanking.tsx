"use client";

import { ehBesst } from "@/lib/besst";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Analise } from "@/lib/db";
import {
  ehPerfilNota, fatoresNota, motivoForaDasBoas, notaDeFatores, PERFIL_PADRAO, PERFIS_NOTA,
  type FatoresNota, type ParteNota, type PerfilNota,
} from "@/lib/boaEmpresa";
import { brl, dataBr, num, pct } from "@/lib/format";
import { Logo } from "../Logo";
import { TipoAtivo } from "../TipoAtivo";
import { Alertas, Nota, Sinal, Variacao } from "../ui";

type Filtro = "todas" | "analisadas" | "carteira" | "comprar" | "abaixo" | "besst";
const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: "todas", rotulo: "Toda a bolsa" },
  { id: "analisadas", rotulo: "Analisadas" },
  { id: "carteira", rotulo: "Na carteira" },
  { id: "comprar", rotulo: "Sinal Comprar" },
  { id: "abaixo", rotulo: "Abaixo do teto" },
  { id: "besst", rotulo: "BESST e FIIs" },
];

/** Volume médio diário mínimo (R$, últimos 2 meses). */
const LIQUIDEZ = [
  { valor: 0, rotulo: "Qualquer liquidez" },
  { valor: 100_000, rotulo: "Liquidez ≥ R$ 100 mil/dia" },
  { valor: 1_000_000, rotulo: "Liquidez ≥ R$ 1 mi/dia" },
  { valor: 10_000_000, rotulo: "Liquidez ≥ R$ 10 mi/dia" },
];

type Linha = Analise & { _nota: { nota: number; partes: ParteNota[] } | null };
type Coluna = { id: string; rotulo: string; valor: (a: Linha) => number | null; alinhar?: "right" | "center"; dica?: string };

const lpaMedio = (a: Analise) => a.lpa_medio ?? (typeof a.indicadores?.lpaMedio === "number" ? (a.indicadores.lpaMedio as number) : null);

const COLUNAS: Coluna[] = [
  { id: "preco", rotulo: "Cotação", valor: (a) => a.preco, alinhar: "right" },
  { id: "teto", rotulo: "Preço teto", valor: (a) => a.preco_teto, alinhar: "right", dica: "Ações: método escolhido" },
  { id: "margem", rotulo: "Margem", valor: (a) => a.margem, alinhar: "right", dica: "Quanto o preço pode subir até o teto (negativo: está acima do teto)" },
  { id: "rank", rotulo: "Nota", valor: (a) => a._nota?.nota ?? null, alinhar: "center", dica: "0 a 100 pelo perfil escolhido. Abra a linha para ver quanto cada parte somou" },
  { id: "lucro10", rotulo: "Lucro 10a", valor: (a) => (a.constancia?.anos ? a.constancia.anosComLucro / a.constancia.anos : null), alinhar: "center", dica: "Anos com lucro nos últimos 10 (balanços da CVM)" },
  { id: "div10", rotulo: "Div. 10a", valor: (a) => (a.constancia?.anos ? a.constancia.anosComDividendo / a.constancia.anos : null), alinhar: "center", dica: "Anos com dividendo ou JCP nos últimos 10 (balanços da CVM)" },
  { id: "dy", rotulo: "DY 12m", valor: (a) => a.dy_12m, alinhar: "right" },
  { id: "dpa", rotulo: "DPA 12m", valor: (a) => a.dpa_12m, alinhar: "right", dica: "Dividendo por ação dos últimos 12 meses" },
  { id: "dpamedio", rotulo: "DPA 5a", valor: (a) => a.dpa_medio, alinhar: "right", dica: "Dividendo médio por ação dos últimos 5 anos (o Bazin usa o menor entre ele e o de 12 meses)" },
  { id: "pl", rotulo: "P/L", valor: (a) => (a.preco && a.lpa && a.lpa > 0 ? a.preco / a.lpa : null), alinhar: "right" },
  { id: "pvp", rotulo: "P/VP", valor: (a) => (a.preco && a.vpa && a.vpa > 0 ? a.preco / a.vpa : null), alinhar: "right" },
  { id: "roe", rotulo: "ROE", valor: (a) => a.roe, alinhar: "right" },
  { id: "divida", rotulo: "Dív./PL", valor: (a) => a.divida ?? null, alinhar: "right", dica: "Dívida bruta ÷ patrimônio (Fundamentus; bancos não têm)" },
  { id: "cresc", rotulo: "Cresc. lucro", valor: (a) => a.constancia?.crescimentoLucro ?? null, alinhar: "right", dica: "Crescimento do lucro ao ano em 10 anos (média dos 3 primeiros contra os 3 últimos, CVM)" },
  { id: "qualidade", rotulo: "Qualidade", valor: (a) => a.qualidade, alinhar: "center", dica: "0 a 10, só com o balanço (analisadas)" },
  { id: "nota", rotulo: "Nota IA", valor: (a) => a.nota_ia, alinhar: "center" },
];

type Visao = "essencial" | "dividendos" | "valuation" | "completa";
const VISOES: { id: Visao; rotulo: string; colunas: string[] }[] = [
  { id: "essencial", rotulo: "Essencial", colunas: ["preco", "teto", "margem", "rank", "lucro10", "div10", "dy", "roe"] },
  { id: "dividendos", rotulo: "Dividendos", colunas: ["preco", "teto", "margem", "rank", "dy", "dpa", "dpamedio", "div10", "lucro10"] },
  { id: "valuation", rotulo: "Valuation", colunas: ["preco", "teto", "margem", "rank", "pl", "pvp", "roe", "divida", "cresc"] },
  { id: "completa", rotulo: "Completa", colunas: COLUNAS.map((c) => c.id) },
];
const ehVisao = (v: unknown): v is Visao => VISOES.some((x) => x.id === v);

export type InicialRanking = Partial<Record<"filtro" | "perfil" | "visao" | "setor" | "tipo" | "liq" | "boas" | "classes" | "ordem" | "q", string>>;

/** Fica a classe que você tem na carteira; senão a analisada; senão a mais negociada. */
function melhorClasse(x: Analise, y: Analise): Analise {
  if (x.na_carteira !== y.na_carteira) return x.na_carteira ? x : y;
  if (!!x.fora_da_analise !== !!y.fora_da_analise) return x.fora_da_analise ? y : x;
  return (y.liquidez ?? 0) > (x.liquidez ?? 0) ? y : x;
}

export function TabelaRanking({
  analises, inicial = {}, metodoNome, anterior,
}: {
  analises: Analise[];
  inicial?: InicialRanking;
  metodoNome?: string;
  anterior?: { data: string; fotos: Record<string, FatoresNota> } | null;
}) {
  const [filtro, setFiltro] = useState<Filtro>(FILTROS.some((f) => f.id === inicial.filtro) ? (inicial.filtro as Filtro) : "todas");
  const [setor, setSetor] = useState(inicial.setor ?? "");
  const [tipo, setTipo] = useState(inicial.tipo ?? "");
  const [busca, setBusca] = useState(inicial.q ?? "");
  const [liquidez, setLiquidez] = useState(LIQUIDEZ.some((l) => String(l.valor) === inicial.liq) ? Number(inicial.liq) : 0);
  const [soBoas, setSoBoas] = useState(inicial.boas !== "0");
  const [umaClasse, setUmaClasse] = useState(inicial.classes !== "todas");
  const [perfil, setPerfil] = useState<PerfilNota>(ehPerfilNota(inicial.perfil) ? inicial.perfil : PERFIL_PADRAO);
  const [visao, setVisao] = useState<Visao>(ehVisao(inicial.visao) ? inicial.visao : "essencial");
  const [ordem, setOrdem] = useState<{ col: string; desc: boolean }>(() => {
    const [col, dir] = (inicial.ordem ?? "").split(".");
    return COLUNAS.some((c) => c.id === col) ? { col, desc: dir !== "asc" } : { col: "rank", desc: true };
  });
  const [aberto, setAberto] = useState<string | null>(null);
  const [comoFunciona, setComoFunciona] = useState(false);

  // Perfil e visão sem nada no link: os últimos que você usou neste navegador
  useEffect(() => {
    try {
      const p = localStorage.getItem("ranking:perfil");
      const v = localStorage.getItem("ranking:visao");
      if (!inicial.perfil && ehPerfilNota(p)) setPerfil(p);
      if (!inicial.visao && ehVisao(v)) setVisao(v);
    } catch { /* sem armazenamento */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtros, perfil, visão e ordem no link: dá para voltar, recarregar ou mandar o link sem perder nada
  useEffect(() => {
    const p = new URLSearchParams();
    if (filtro !== "todas") p.set("filtro", filtro);
    if (perfil !== PERFIL_PADRAO) p.set("perfil", perfil);
    if (visao !== "essencial") p.set("visao", visao);
    if (setor) p.set("setor", setor);
    if (tipo) p.set("tipo", tipo);
    if (liquidez) p.set("liq", String(liquidez));
    if (!soBoas) p.set("boas", "0");
    if (!umaClasse) p.set("classes", "todas");
    if (ordem.col !== "rank" || !ordem.desc) p.set("ordem", `${ordem.col}.${ordem.desc ? "desc" : "asc"}`);
    if (busca.trim()) p.set("q", busca.trim());
    const qs = p.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    try {
      localStorage.setItem("ranking:perfil", perfil);
      localStorage.setItem("ranking:visao", visao);
    } catch { /* sem armazenamento */ }
  }, [filtro, perfil, visao, setor, tipo, liquidez, soBoas, umaClasse, ordem, busca]);

  const comNota: Linha[] = useMemo(() => analises.map((a) => ({ ...a, _nota: notaDeFatores(fatoresNota(a), perfil) })), [analises, perfil]);
  const setores = useMemo(() => [...new Set(analises.map((a) => a.setor).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR")), [analises]);
  const colunas = useMemo(() => {
    const ids = VISOES.find((v) => v.id === visao)!.colunas;
    return COLUNAS.filter((c) => ids.includes(c.id) || c.id === ordem.col);
  }, [visao, ordem.col]);

  const { linhas, escondidas, outrasClasses, setas } = useMemo(() => {
    const col = COLUNAS.find((c) => c.id === ordem.col) ?? COLUNAS[3];
    const termo = busca.trim().toUpperCase();
    let todas = comNota
      .filter((a) =>
        filtro === "analisadas" ? !a.fora_da_analise : filtro === "carteira" ? a.na_carteira : filtro === "comprar" ? a.recomendacao === "COMPRAR" : filtro === "abaixo" ? (a.margem ?? -1) > 0 : filtro === "besst" ? ehBesst(a) : true,
      )
      .filter((a) => !setor || a.setor === setor)
      .filter((a) => !tipo || a.tipo === tipo)
      // Sem a liquidez do Fundamentus (FIIs, ETFs, cripto e exterior), as analisadas passam no filtro
      .filter((a) => !liquidez || (a.liquidez == null ? !a.fora_da_analise : a.liquidez >= liquidez))
      .filter((a) => !termo || a.ticker.includes(termo) || (a.nome ?? "").toUpperCase().includes(termo));

    // Uma classe por empresa (PETR3 e PETR4 são a mesma Petrobras). A busca mostra a classe que você digitou.
    const outrasClasses = new Map<string, string[]>();
    if (umaClasse && !termo) {
      const porEmpresa = new Map<number, Linha>();
      for (const a of todas) if (a.empresa != null) porEmpresa.set(a.empresa, porEmpresa.has(a.empresa) ? (melhorClasse(porEmpresa.get(a.empresa)!, a) as Linha) : a);
      const fica = new Set([...porEmpresa.values()].map((a) => a.ticker));
      for (const a of todas) {
        if (a.empresa == null || fica.has(a.ticker)) continue;
        const dono = porEmpresa.get(a.empresa)!.ticker;
        outrasClasses.set(dono, [...(outrasClasses.get(dono) ?? []), a.ticker]);
      }
      todas = todas.filter((a) => a.empresa == null || fica.has(a.ticker));
    }

    todas.sort((x, y) => {
      const vx = col.valor(x);
      const vy = col.valor(y);
      if (vx == null) return 1;
      if (vy == null) return -1;
      return ordem.desc ? vy - vx : vx - vy;
    });
    // A busca por código mostra a ação mesmo fora do filtro
    const linhas = soBoas && !termo && filtro !== "carteira" ? todas.filter((a) => !motivoForaDasBoas(a)) : todas;

    // Seta de posição: a ordem destas mesmas linhas pela Nota da foto anterior (mesmo perfil e método) contra a de hoje
    const setas = new Map<string, number | "nova">();
    if (anterior && col.id === "rank" && ordem.desc) {
      const notaAntes = new Map<string, number>();
      for (const a of linhas) {
        const f = anterior.fotos[a.ticker];
        const n = f ? notaDeFatores(f, perfil)?.nota : null;
        if (n != null) notaAntes.set(a.ticker, n);
      }
      const hoje = linhas.filter((a) => a._nota && notaAntes.has(a.ticker)).map((a) => a.ticker);
      const antes = [...hoje].sort((x, y) => notaAntes.get(y)! - notaAntes.get(x)!);
      const posAntes = new Map(antes.map((t, i) => [t, i]));
      hoje.forEach((t, i) => setas.set(t, posAntes.get(t)! - i));
      for (const a of linhas) if (a._nota && !anterior.fotos[a.ticker]) setas.set(a.ticker, "nova");
    }
    return { linhas, escondidas: todas.length - linhas.length, outrasClasses, setas };
  }, [comNota, filtro, setor, tipo, liquidez, soBoas, umaClasse, busca, ordem, anterior, perfil]);

  const fmt = (id: string, a: Linha): ReactNode => {
    switch (id) {
      case "preco": return <><p>{brl(a.preco)}</p><p className="text-[11px]"><Variacao v={a.variacao_dia} casas={2} /></p></>;
      case "teto": return brl(a.preco_teto);
      case "margem": return <Variacao v={a.margem} />;
      case "rank": return <NotaRanking a={a} seta={setas.get(a.ticker)} />;
      case "lucro10": case "div10": {
        const c = a.constancia;
        if (!c?.anos) return <span className="text-fraco">—</span>;
        const n = id === "lucro10" ? c.anosComLucro : c.anosComDividendo;
        const cor = n / c.anos >= 0.7 ? "text-alta" : n / c.anos >= 0.5 ? "text-amber-300" : "text-baixa";
        return <span className={`tabular-nums ${cor}`}>{n}/{c.anos}</span>;
      }
      case "dy": return pct(a.dy_12m);
      case "dpa": return brl(a.dpa_12m);
      case "dpamedio": return brl(a.dpa_medio);
      case "pl": case "pvp": case "divida": return num(COLUNAS.find((c) => c.id === id)!.valor(a));
      case "roe": return pct(a.roe);
      case "cresc": return a.constancia?.crescimentoLucro == null ? <span className="text-fraco">—</span> : <Variacao v={a.constancia.crescimentoLucro} />;
      case "qualidade": return <Nota v={a.qualidade} />;
      case "nota": return <Nota v={a.nota_ia} />;
    }
    return null;
  };

  const perfilAtual = PERFIS_NOTA.find((p) => p.id === perfil)!;
  const alternar = (t: string) => setAberto(aberto === t ? null : t);

  return (
    <div className="cartao">
      <div className="space-y-3 border-b border-borda p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {FILTROS.map((f) => (
              <button key={f.id} onClick={() => setFiltro(f.id)} className={`chip ${filtro === f.id ? "chip-ativo" : ""}`}>
                {f.rotulo}
              </button>
            ))}
          </div>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar ação ou empresa" className="campo w-full lg:w-56" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={perfil} onChange={(e) => setPerfil(e.target.value as PerfilNota)} className="campo" aria-label="Perfil da Nota" title={perfilAtual.descricao}>
            {PERFIS_NOTA.map((p) => <option key={p.id} value={p.id}>Nota: {p.nome}</option>)}
          </select>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="campo">
            <option value="">Ações, FIIs e ETFs</option>
            <option value="acao">Só ações</option>
            <option value="fii">Só FIIs</option>
            <option value="etf">Só ETFs</option>
          </select>
          <select value={liquidez} onChange={(e) => setLiquidez(Number(e.target.value))} className="campo" aria-label="Liquidez mínima">
            {LIQUIDEZ.map((l) => <option key={l.valor} value={l.valor}>{l.rotulo}</option>)}
          </select>
          <select value={setor} onChange={(e) => setSetor(e.target.value)} className="campo min-w-0 max-w-full flex-1 sm:flex-none lg:w-56">
            <option value="">Todos os setores</option>
            {setores.map((s) => <option key={s}>{s}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-suave" title="Lucro em 7 de 10 anos e dividendo em 5 de 10 (balanços da CVM), lucro nos últimos 12 meses, ROE de 10% ou mais, margem líquida positiva, dívida bruta de até 2x o patrimônio, patrimônio de R$ 1 bi ou mais, liquidez de R$ 1 mi por dia e com preço teto. Analisadas: qualidade 6 ou mais.">
            <input type="checkbox" checked={soBoas} onChange={(e) => setSoBoas(e.target.checked)} className="accent-[var(--marca,#22c55e)]" />
            Só boas empresas
          </label>
          <label className="flex items-center gap-1.5 text-sm text-suave" title="PETR3 e PETR4 são a mesma empresa: fica a classe que você tem na carteira, senão a analisada, senão a mais negociada">
            <input type="checkbox" checked={umaClasse} onChange={(e) => setUmaClasse(e.target.checked)} className="accent-[var(--marca,#22c55e)]" />
            Uma classe por empresa
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-suave">
            <span className="mr-1">Colunas:</span>
            {VISOES.map((v) => (
              <button key={v.id} onClick={() => setVisao(v.id)} className={`chip ${visao === v.id ? "chip-ativo" : ""}`}>{v.rotulo}</button>
            ))}
          </div>
          <button onClick={() => setComoFunciona(!comoFunciona)} className="text-xs text-marca hover:underline" aria-expanded={comoFunciona}>
            {comoFunciona ? "Fechar" : "Como a Nota funciona"}
          </button>
        </div>
        {comoFunciona && <ComoFunciona perfil={perfil} anterior={anterior?.data ?? null} />}
      </div>

      {/* Celular: cartões */}
      <ul className="divide-y divide-borda md:hidden">
        {linhas.map((a, i) => (
          <li key={a.ticker}>
            <button onClick={() => alternar(a.ticker)} className="flex w-full items-center gap-3 p-3 text-left">
              <span className="w-6 text-xs text-fraco">{i + 1}</span>
              <Logo ticker={a.ticker} src={a.logo} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 font-medium"><Etiquetas a={a} outras={outrasClasses.get(a.ticker)} /></p>
                <p className="mt-0.5 text-xs text-suave tabular-nums">
                  {brl(a.preco)} · teto {brl(a.preco_teto)} · <Variacao v={a.margem} />
                </p>
                <p className="truncate text-[11px] text-fraco">
                  {[a.setor, a.constancia?.anos ? `lucro ${a.constancia.anosComLucro}/${a.constancia.anos}` : null, a.dy_12m != null ? `DY ${pct(a.dy_12m)}` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              <NotaRanking a={a} seta={setas.get(a.ticker)} grande />
            </button>
            {aberto === a.ticker && <div className="bg-painel2/40 px-3 pb-3"><Detalhe a={a} outras={outrasClasses.get(a.ticker)} /></div>}
          </li>
        ))}
      </ul>

      {/* Telas maiores: tabela */}
      <div className="hidden overflow-x-auto md:block">
        <table className="tabela" data-sem-ordem>
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th>Ativo</th>
              {colunas.map((c) => (
                <th key={c.id} className={c.alinhar === "right" ? "!text-right" : c.alinhar === "center" ? "!text-center" : ""} title={c.id === "teto" && metodoNome ? `Ações: ${metodoNome}` : c.dica}>
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
                <tr onClick={() => alternar(a.ticker)} className="cursor-pointer">
                  <td className="text-fraco">{i + 1}</td>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Logo ticker={a.ticker} src={a.logo} />
                      <div>
                        <p className="flex items-center gap-1.5 font-medium"><Etiquetas a={a} outras={outrasClasses.get(a.ticker)} /></p>
                        <p className="max-w-44 truncate text-[11px] text-fraco" title={a.nome ?? undefined}>{a.setor ?? a.nome}</p>
                      </div>
                    </div>
                  </td>
                  {colunas.map((c) => (
                    <td key={c.id} className={c.alinhar === "right" ? "text-right" : c.alinhar === "center" ? "text-center" : ""}>
                      {fmt(c.id, a)}
                    </td>
                  ))}
                  <td><Sinal r={a.recomendacao} /></td>
                </tr>
                {aberto === a.ticker && (
                  <tr className="!bg-painel2/40">
                    <td />
                    <td colSpan={colunas.length + 2} className="!whitespace-normal"><Detalhe a={a} outras={outrasClasses.get(a.ticker)} /></td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {linhas.length === 0 && <p className="p-8 text-center text-sm text-suave">Nenhuma ação com esses filtros.</p>}
      {soBoas && escondidas > 0 && (
        <p className="border-t border-borda p-3 text-center text-xs text-suave">
          {escondidas} {escondidas === 1 ? "ação ficou" : "ações ficaram"} de fora pelo filtro "Só boas empresas" (lucro em 7 de 10 anos, dividendo em 5 de 10, ROE de 10% ou mais,
          dívida controlada, porte, liquidez e preço teto; analisadas com qualidade 6 ou mais).{" "}
          <button onClick={() => setSoBoas(false)} className="text-marca hover:underline">Ver todas</button>
        </p>
      )}
    </div>
  );
}

function Etiquetas({ a, outras }: { a: Analise; outras?: string[] }) {
  return (
    <>
      <Link href={`/acao/${a.ticker}`} onClick={(e) => e.stopPropagation()} className="hover:text-marca">{a.ticker}</Link>
      <TipoAtivo tipo={a.tipo} />
      {outras?.length ? (
        <span className="rounded bg-painel2 px-1 text-[10px] text-suave ring-1 ring-borda" title={`Mesma empresa: ${outras.join(", ")}`}>+{outras.length}</span>
      ) : null}
      {a.na_carteira && <span className="rounded bg-[#3987e5]/15 px-1 text-[10px] font-semibold text-[#6da7ec]">CARTEIRA</span>}
      {a.garimpo && (
        <span className="rounded bg-marca/15 px-1 text-[10px] font-semibold text-marca" title="Achado pelo garimpo automático: fora da sua carteira e da lista fixa">GARIMPO</span>
      )}
      {a.fora_da_analise && (
        <span className="rounded bg-painel2 px-1 text-[10px] font-semibold text-suave ring-1 ring-borda" title="Fora da análise diária: teto estimado com os números do Fundamentus e os balanços da CVM, sem qualidade e IA">B3</span>
      )}
      {a.alertas && <span className="text-[11px] text-amber-300" title={a.alertas}>⚠</span>}
    </>
  );
}

/** A Nota com a seta de quantas posições subiu ou caiu desde a foto anterior do ranking. */
function NotaRanking({ a, seta, grande = false }: { a: Linha; seta?: number | "nova"; grande?: boolean }) {
  const n = a._nota?.nota;
  if (n == null) return <span className="text-fraco">—</span>;
  const cor = n >= 70 ? "text-alta" : n >= 50 ? "text-texto" : "text-suave";
  return (
    <span className={`inline-flex flex-col items-center ${grande ? "min-w-10" : ""}`}>
      <span className={`font-semibold tabular-nums ${cor} ${grande ? "text-lg leading-tight" : ""}`}>{n}</span>
      {seta === "nova" ? (
        <span className="text-[10px] text-marca" title="Não estava na foto anterior do ranking">novo</span>
      ) : seta ? (
        <span className={`text-[10px] tabular-nums ${seta > 0 ? "text-alta" : "text-baixa"}`} title={`${seta > 0 ? "Subiu" : "Caiu"} ${Math.abs(seta)} ${Math.abs(seta) === 1 ? "posição" : "posições"} desde a análise anterior`}>
          {seta > 0 ? "▲" : "▼"}{Math.abs(seta)}
        </span>
      ) : null}
    </span>
  );
}

function Detalhe({ a, outras }: { a: Linha; outras?: string[] }) {
  const fora = motivoForaDasBoas(a);
  const medio = lpaMedio(a);
  return (
    <div className="grid gap-4 py-1 md:grid-cols-[1.4fr_1fr_1fr]">
      <div className="space-y-1.5 text-sm">
        {a.nome && <p className="text-xs text-suave">{a.nome}{a.setor ? ` · ${a.setor}` : ""}</p>}
        <p className="text-texto">
          {a.fora_da_analise
            ? "Fora da análise diária: preço teto estimado com a cotação de fechamento, o P/L, o P/VP e o dividend yield do Fundamentus, com o lucro e o dividendo médios de 5 anos dos balanços da CVM. Sem nota de qualidade e comentário da IA. Abra a ação para a análise completa."
            : a.resumo_ia ?? "Sem comentário da IA."}
        </p>
        {a.riscos_ia && <p className="text-xs text-amber-300/80">Risco: {a.riscos_ia}</p>}
        <Alertas txt={a.alertas} />
        {fora && <p className="text-xs text-suave">Fora do filtro de boas empresas: {fora}.</p>}
        {outras?.length ? <p className="text-xs text-suave">Mesma empresa: {outras.join(", ")} (desligue "Uma classe por empresa" para ver).</p> : null}
      </div>
      <PorQueANota partes={a._nota?.partes ?? null} nota={a._nota?.nota ?? null} />
      <div className="space-y-0.5 text-xs text-suave">
        <p>Teto Bazin: {brl(a.teto_bazin)} · Graham: {brl(a.teto_graham)} · Buffett: {brl(a.teto_buffett)}</p>
        <p>DPA 12m: {brl(a.dpa_12m)} · Média 5 anos: {brl(a.dpa_medio)}</p>
        {a.lpa != null && (
          <p>
            LPA 12m: {brl(a.lpa)}
            {medio != null && <> · Média 5 anos: {brl(medio)}{a.lpa > 0 && medio < a.lpa * 0.8 ? " (o teto usa a média)" : ""}</>}
          </p>
        )}
        {a.liquidez != null && <p>Liquidez: {brl(a.liquidez)} por dia (média de 2 meses)</p>}
        <Link href={`/acao/${a.ticker}`} className="mt-2 inline-block text-marca hover:underline">Ver detalhes de {a.ticker} →</Link>
      </div>
    </div>
  );
}

/** Quanto cada parte somou na Nota. */
function PorQueANota({ partes, nota }: { partes: ParteNota[] | null; nota: number | null }) {
  if (!partes || nota == null) return <p className="text-xs text-suave">Sem Nota: falta o preço teto.</p>;
  return (
    <div className="text-xs">
      <p className="mb-1.5 font-medium text-texto">Por que a Nota é {nota}</p>
      <ul className="space-y-1">
        {partes.map((p) => (
          <li key={p.id} className="grid grid-cols-[1fr_4rem_3.2rem] items-center gap-2" title={`${Math.round(p.valor * 100)}% de ${Math.round(p.peso)} pontos possíveis`}>
            <span className="truncate text-suave">{p.rotulo}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-borda">
              <span className="block h-full rounded-full bg-marca" style={{ width: `${Math.round(p.valor * 100)}%` }} />
            </span>
            <span className="text-right tabular-nums text-suave">{num(p.pontos, 0)}/{num(p.peso, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ComoFunciona({ perfil, anterior }: { perfil: PerfilNota; anterior: string | null }) {
  const p = PERFIS_NOTA.find((x) => x.id === perfil)!;
  return (
    <div className="space-y-2 rounded-lg bg-painel2/50 p-3 text-xs leading-relaxed text-suave">
      <p>
        <b className="text-texto">Nota de 0 a 100, uma só para toda a bolsa.</b> No perfil {p.nome} ({p.descricao.toLowerCase()}):{" "}
        {p.pesos.desconto}% desconto até o preço teto, {p.pesos.lucro}% anos com lucro, {p.pesos.dividendo}% anos com dividendo, {p.pesos.roe}% ROE,{" "}
        {p.pesos.crescimento}% crescimento do lucro em 10 anos e {p.pesos.divida}% dívida. O desconto conta até 40% abaixo do teto (mais que isso costuma
        ser armadilha) e vale proporcional aos anos com lucro. Sem dado (dívida dos bancos, crescimento com pouco histórico), o fator sai da conta e
        os outros pesos crescem. Nas ações analisadas, 15% da Nota vem da qualidade do balanço e da nota da IA. FIIs e ETFs: desconto e análise.
      </p>
      <p>
        <b className="text-texto">Preço teto mais conservador.</b> Graham, Buffett e P/L justo usam o menor entre o lucro de 12 meses e a média dos últimos 5
        anos na CVM (uma empresa no pico do ciclo não parece barata). Nas ações com a etiqueta B3, o Bazin usa o menor entre o dividendo de 12 meses e a
        média de 5 anos da CVM (um dividendo extraordinário não infla o teto).
      </p>
      <p>
        <b className="text-texto">Seta ▲▼:</b> quantas posições a ação subiu ou caiu desde a análise anterior{anterior ? ` (${dataBr(anterior)})` : ""}, com
        os mesmos filtros, perfil e método, ordenando pela Nota. {anterior ? "" : "Aparece a partir da próxima análise."}
      </p>
    </div>
  );
}
