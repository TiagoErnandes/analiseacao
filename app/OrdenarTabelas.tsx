"use client";

import { useEffect } from "react";

/**
 * Ordenação clicável em todas as tabelas do site: clique no título de uma coluna para ordenar (de novo para inverter, uma terceira vez
 * para voltar à ordem original). Funciona em qualquer <table> com <thead>, sem mexer em cada página.
 * - Tabelas com `data-sem-ordem` ficam de fora (o ranking tem a ordenação própria).
 * - Uma célula pode dizer o valor de ordenação em `data-ordem` (ex.: "2026-11" num mês escrito por extenso).
 * - Números em pt-BR (R$ 1.234,56 · +3,2% · ▼ 1,0%), datas dd/mm/aaaa e texto; "—" e vazios vão sempre para o fim.
 * - Quando os preços se atualizam sozinhos, a ordem escolhida é reaplicada.
 */

type Estado = { col: number; desc: boolean; original: Element[] };
const estados = new WeakMap<HTMLTableSectionElement, Estado>();

/** A célula da linha que cobre a coluna `col` (respeitando colSpan). */
function celula(tr: HTMLTableRowElement, col: number): HTMLTableCellElement | null {
  let i = 0;
  for (const c of Array.from(tr.cells)) {
    const span = c.colSpan || 1;
    if (col < i + span) return span > 1 ? null : c; // célula mesclada não tem valor da coluna
    i += span;
  }
  return null;
}

function indiceColuna(th: HTMLTableCellElement): number {
  let i = 0;
  for (const c of Array.from((th.parentElement as HTMLTableRowElement).cells)) {
    if (c === th) return i;
    i += c.colSpan || 1;
  }
  return -1;
}

type Chave = { n: number } | { s: string } | null;

function chave(td: HTMLTableCellElement | null): Chave {
  if (!td) return null;
  const explicito = td.getAttribute("data-ordem") ?? td.querySelector("[data-ordem]")?.getAttribute("data-ordem");
  const bruto = (explicito ?? td.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!bruto || bruto === "—" || bruto === "-") return null;
  if (explicito != null && explicito !== "" && Number.isFinite(Number(explicito))) return { n: Number(explicito) };
  const data = bruto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (data) return { n: Number(data[3] + data[2] + data[1]) };
  // Número pt-BR: tira moeda, setas e espaços; "1.234,56" → 1234.56; o sinal pode vir de ▼ ou de "−"
  const m = bruto.match(/^[▲▼+\-−\s]*(?:R\$|US\$|\$)?\s*[+\-−]?\s*\d[\d.]*(?:,\d+)?\s*(%|mil|mi|bi)?/i);
  if (m) {
    const neg = /[▼\-−]/.test(m[0]);
    const digitos = m[0].match(/\d[\d.]*(?:,\d+)?/)![0].replace(/\./g, "").replace(",", ".");
    let n = Number(digitos);
    const mult = m[1]?.toLowerCase();
    if (mult === "mil") n *= 1e3;
    else if (mult === "mi") n *= 1e6;
    else if (mult === "bi") n *= 1e9;
    if (Number.isFinite(n)) return { n: neg ? -n : n };
  }
  return { s: bruto.toLocaleLowerCase("pt-BR") };
}

function comparar(a: Chave, b: Chave, desc: boolean): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // vazios sempre no fim
  if (b == null) return -1;
  let r: number;
  if ("n" in a && "n" in b) r = a.n - b.n;
  else if ("n" in a) r = -1; // números antes de texto
  else if ("n" in b) r = 1;
  else r = a.s.localeCompare(b.s, "pt-BR", { numeric: true });
  return desc ? -r : r;
}

function aplicar(tbody: HTMLTableSectionElement, e: Estado) {
  const linhas = Array.from(tbody.rows);
  let alvo: Element[];
  if (e.col < 0) {
    alvo = e.original.filter((l) => l.parentElement === tbody);
    for (const l of linhas) if (!alvo.includes(l)) alvo.push(l);
  } else {
    alvo = linhas
      .map((l, i) => ({ l, i, k: chave(celula(l, e.col)) }))
      .sort((x, y) => comparar(x.k, y.k, e.desc) || x.i - y.i)
      .map((x) => x.l);
  }
  // Só mexe no DOM se a ordem mudou (evita laço com o observador)
  if (alvo.every((l, i) => linhas[i] === l)) return;
  for (const l of alvo) tbody.appendChild(l);
}

function marcarCabecalho(table: HTMLTableElement, col: number, desc: boolean) {
  for (const th of Array.from(table.tHead?.querySelectorAll("th") ?? [])) {
    if (col >= 0 && indiceColuna(th as HTMLTableCellElement) === col && th.parentElement === table.tHead!.rows[table.tHead!.rows.length - 1]) {
      th.setAttribute("data-ordem-dir", desc ? "desc" : "asc");
      th.setAttribute("aria-sort", desc ? "descending" : "ascending");
    } else {
      th.removeAttribute("data-ordem-dir");
      th.removeAttribute("aria-sort");
    }
  }
}

export function OrdenarTabelas() {
  useEffect(() => {
    const ordenaveis = (t: Element | null): t is HTMLTableElement =>
      !!t && t instanceof HTMLTableElement && !t.hasAttribute("data-sem-ordem") && !!t.tHead && t.tBodies.length > 0;

    const aoClicar = (ev: MouseEvent) => {
      const alvo = ev.target as Element | null;
      if (!alvo || alvo.closest("button, a, input, select, textarea, label")) return;
      const th = alvo.closest("th") as HTMLTableCellElement | null;
      const table = th?.closest("table") ?? null;
      if (!th || !ordenaveis(table) || !table.tHead!.contains(th) || !th.textContent?.trim()) return;
      const tbody = table.tBodies[0];
      if (tbody.rows.length < 2) return;
      const col = indiceColuna(th);
      const atual = estados.get(tbody) ?? { col: -1, desc: false, original: Array.from(tbody.rows) };
      if (atual.col < 0) atual.original = Array.from(tbody.rows);
      // 1º clique: maior primeiro em números (o mais útil em carteira), A→Z em texto; 2º inverte; 3º volta ao original
      const amostra = Array.from(tbody.rows).map((l) => chave(celula(l, col))).find((k) => k != null);
      const primeiroDesc = !!amostra && "n" in amostra;
      const novo: Estado =
        atual.col !== col
          ? { col, desc: primeiroDesc, original: atual.original }
          : atual.desc === primeiroDesc
            ? { ...atual, desc: !primeiroDesc }
            : { col: -1, desc: false, original: atual.original };
      estados.set(tbody, novo);
      aplicar(tbody, novo);
      marcarCabecalho(table, novo.col, novo.desc);
    };

    const marcarTabelas = () => {
      for (const t of Array.from(document.querySelectorAll("table"))) {
        if (ordenaveis(t)) t.setAttribute("data-ordenavel", "");
      }
    };
    marcarTabelas();

    // Quando a página re-renderiza (preços novos, troca de página), reaplica a ordem escolhida
    let agendado = false;
    const obs = new MutationObserver(() => {
      if (agendado) return;
      agendado = true;
      requestAnimationFrame(() => {
        agendado = false;
        marcarTabelas();
        for (const t of Array.from(document.querySelectorAll("table[data-ordenavel]"))) {
          const tbody = (t as HTMLTableElement).tBodies[0];
          const e = tbody && estados.get(tbody);
          if (e && e.col >= 0) {
            aplicar(tbody, e);
            marcarCabecalho(t as HTMLTableElement, e.col, e.desc);
          }
        }
      });
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("click", aoClicar);
    return () => {
      obs.disconnect();
      document.removeEventListener("click", aoClicar);
    };
  }, []);
  return null;
}
