"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "./Logo";
import { TipoAtivo } from "./TipoAtivo";

type Ativo = { ticker: string; nome: string | null; tipo: string | null; logo: string | null };

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca de ativos no topo do site (atalho: tecla "/"). Enter abre a página do ativo. */
export function BuscaAtivo() {
  const router = useRouter();
  const [ativos, setAtivos] = useState<Ativo[] | null>(null);
  const [texto, setTexto] = useState("");
  const [aberto, setAberto] = useState(false);
  const [sel, setSel] = useState(0);
  const campo = useRef<HTMLInputElement>(null);

  // Lista carregada só quando a pessoa usa a busca
  function carregar() {
    if (ativos) return;
    setAtivos([]);
    fetch("/api/ativos")
      .then((r) => r.json())
      .then((l: Ativo[]) => setAtivos(Array.isArray(l) ? l : []))
      .catch(() => setAtivos([]));
  }

  useEffect(() => {
    function atalho(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement;
      if (e.key === "/" && !/input|textarea|select/i.test(alvo.tagName) && !alvo.isContentEditable) {
        e.preventDefault();
        campo.current?.focus();
      }
    }
    window.addEventListener("keydown", atalho);
    return () => window.removeEventListener("keydown", atalho);
  }, []);

  const resultados = useMemo(() => {
    const q = semAcento(texto.trim());
    if (!q || !ativos) return [];
    return ativos
      .map((a) => {
        const t = a.ticker.toLowerCase();
        const n = semAcento(a.nome ?? "");
        const pontos = t === q ? 0 : t.startsWith(q) ? 1 : n.startsWith(q) ? 2 : t.includes(q) || n.includes(q) ? 3 : 9;
        return { a, pontos };
      })
      .filter((r) => r.pontos < 9)
      .sort((x, y) => x.pontos - y.pontos || x.a.ticker.localeCompare(y.a.ticker))
      .slice(0, 8)
      .map((r) => r.a);
  }, [texto, ativos]);

  function abrir(ticker: string) {
    setTexto("");
    setAberto(false);
    campo.current?.blur();
    router.push(`/acao/${encodeURIComponent(ticker.toUpperCase())}`);
  }

  return (
    <form
      role="search"
      className="relative w-full"
      onSubmit={(e) => {
        e.preventDefault();
        const escolhido = resultados[sel]?.ticker ?? texto.trim();
        if (/^[A-Za-z0-9.]{2,12}$/.test(escolhido)) abrir(escolhido);
      }}
    >
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fraco" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={campo}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setSel(0);
          setAberto(true);
        }}
        onFocus={() => {
          carregar();
          setAberto(true);
        }}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, resultados.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          if (e.key === "Escape") { setAberto(false); campo.current?.blur(); }
        }}
        placeholder="Buscar ativo (PETR4, Itaú, MXRF11...)"
        aria-label="Buscar ativo"
        autoComplete="off"
        spellCheck={false}
        className="h-9 w-full rounded-lg border border-borda bg-painel pl-9 pr-10 text-sm outline-none transition placeholder:text-fraco focus:border-marca/70 focus:bg-fundo"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-borda px-1.5 text-[10px] text-fraco sm:block">/</kbd>
      {aberto && texto.trim() && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border border-borda bg-painel shadow-2xl">
          {resultados.length ? (
            <ul role="listbox">
              {resultados.map((a, i) => (
                <li key={a.ticker} role="option" aria-selected={i === sel}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => abrir(a.ticker)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${i === sel ? "bg-painel2" : ""}`}
                  >
                    <Logo ticker={a.ticker} src={a.logo} tamanho={24} />
                    <span className="font-semibold">{a.ticker}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-suave">{a.nome}</span>
                    <TipoAtivo tipo={a.tipo} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-xs text-suave">
              {ativos?.length ? "Nenhum ativo analisado com esse nome." : "Carregando..."} Enter abre <b className="text-texto">{texto.trim().toUpperCase()}</b>.
            </p>
          )}
        </div>
      )}
    </form>
  );
}
