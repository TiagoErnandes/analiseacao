"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ItemImportado, ResultadoB3 } from "@/lib/b3";
import { brl } from "@/lib/format";
import { aplicarImportacaoB3, lerArquivosB3 } from "./actions";

type Atual = { ticker: string; quantidade: number; preco_medio: number };
type Linha = ItemImportado & { pmTexto: string; incluir: boolean };

const ORIGEM: Record<string, { txt: string; cls: string }> = {
  negociacoes: { txt: "das negociações", cls: "text-alta" },
  carteira: { txt: "já cadastrado", cls: "text-[#6da7ec]" },
  fechamento: { txt: "preço de fechamento", cls: "text-amber-300" },
};

const paraNumero = (t: string) => Number(t.replace(/\./g, "").replace(",", "."));

export function ImportadorB3({ atual }: { atual: Atual[] }) {
  const router = useRouter();
  const [lendo, startLer] = useTransition();
  const [salvando, startSalvar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoB3 | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [modo, setModo] = useState<"substituir" | "atualizar">("atualizar");

  const porTicker = new Map(atual.map((a) => [a.ticker, a]));
  const selecionadas = linhas.filter((l) => l.incluir);
  const removidas = modo === "substituir" ? atual.filter((a) => !selecionadas.some((l) => l.ticker === a.ticker)) : [];
  const invalida = selecionadas.some((l) => !(paraNumero(l.pmTexto) >= 0) || l.pmTexto.trim() === "");

  function ler(form: FormData) {
    setErro(null);
    setOk(null);
    startLer(async () => {
      const r = await lerArquivosB3(form);
      if (!r.ok) {
        setErro(r.erro);
        setResultado(null);
        return;
      }
      setResultado(r.resultado);
      setLinhas(
        r.resultado.itens.map((i) => ({
          ...i,
          incluir: true,
          pmTexto: i.precoMedio != null ? i.precoMedio.toFixed(2).replace(".", ",") : "",
        })),
      );
    });
  }

  function salvar() {
    startSalvar(async () => {
      const r = await aplicarImportacaoB3(
        selecionadas.map((l) => ({ ticker: l.ticker, quantidade: l.quantidade, preco_medio: paraNumero(l.pmTexto) })),
        modo,
      );
      if (r.ok) {
        setOk(r.mensagem);
        setResultado(null);
        setLinhas([]);
        router.refresh();
      } else setErro(r.mensagem);
    });
  }

  return (
    <div className="space-y-4 p-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-suave">
        <li>
          Entre na{" "}
          <a href="https://www.investidor.b3.com.br" target="_blank" rel="noreferrer" className="text-marca hover:underline">
            Área do Investidor da B3
          </a>{" "}
          e vá em <b className="text-texto">Extratos → Posição</b>. Baixe em <b className="text-texto">Excel</b>.
        </li>
        <li>
          Para trazer o <b className="text-texto">preço médio</b>, baixe também <b className="text-texto">Extratos → Negociação</b>{" "}
          com o período desde a sua primeira compra (pode enviar vários arquivos juntos).
        </li>
        <li>Envie os arquivos abaixo, confira a prévia e confirme.</li>
      </ol>

      <form action={ler} className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="arquivos"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          multiple
          required
          className="text-sm text-suave file:mr-3 file:rounded-lg file:border-0 file:bg-painel2 file:px-3 file:py-2 file:text-sm file:text-texto hover:file:bg-borda"
        />
        <button className="botao" disabled={lendo}>
          {lendo && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-fundo/30 border-t-fundo" />}
          {lendo ? "Lendo…" : "Ler arquivos"}
        </button>
      </form>

      {erro && <p className="rounded-lg bg-baixa/10 p-3 text-sm text-baixa">{erro}</p>}
      {ok && <p className="rounded-lg bg-alta/10 p-3 text-sm text-alta">✓ {ok}</p>}

      {resultado && (
        <div className="space-y-4">
          <p className="text-xs text-fraco">Lido: {resultado.arquivos.join(" · ")}</p>

          {linhas.length === 0 ? (
            <p className="rounded-lg bg-amber-400/5 p-3 text-sm text-amber-200/90">
              Nenhum ativo encontrado nesse arquivo. O app analisa ações, FIIs e ETFs; veja abaixo o que ficou de fora.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-borda">
              <table className="tabela">
                <thead>
                  <tr>
                    <th />
                    <th>Ativo</th>
                    <th className="!text-right">Quantidade</th>
                    <th>Preço médio (R$)</th>
                    <th>Hoje no app</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l, idx) => {
                    const a = porTicker.get(l.ticker);
                    const mudou = a && (a.quantidade !== l.quantidade || Math.abs(a.preco_medio - paraNumero(l.pmTexto)) > 0.005);
                    return (
                      <tr key={l.ticker} className={l.incluir ? "" : "opacity-40"}>
                        <td>
                          <input
                            type="checkbox"
                            checked={l.incluir}
                            onChange={(e) => setLinhas((ls) => ls.map((x, i) => (i === idx ? { ...x, incluir: e.target.checked } : x)))}
                            className="accent-emerald-500"
                          />
                        </td>
                        <td className="!whitespace-normal">
                          <p className="font-medium">{l.ticker}</p>
                          {l.aviso && <p className="max-w-80 text-[11px] text-amber-300/90">⚠ {l.aviso}</p>}
                        </td>
                        <td className="text-right">{l.quantidade}</td>
                        <td>
                          <input
                            value={l.pmTexto}
                            onChange={(e) => setLinhas((ls) => ls.map((x, i) => (i === idx ? { ...x, pmTexto: e.target.value } : x)))}
                            inputMode="decimal"
                            className="campo w-24 !py-1"
                          />
                          {l.origemPm && <p className={`text-[10px] ${ORIGEM[l.origemPm].cls}`}>{ORIGEM[l.origemPm].txt}</p>}
                        </td>
                        <td className="text-xs">
                          {!a ? (
                            <span className="rounded bg-alta/10 px-1.5 py-0.5 font-semibold text-alta">nova</span>
                          ) : mudou ? (
                            <span className="text-suave">{a.quantidade} × {brl(a.preco_medio)} <span className="text-amber-300">→ muda</span></span>
                          ) : (
                            <span className="text-fraco">igual</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {resultado.ignorados.length > 0 && (
            <details className="rounded-lg border border-borda p-3 text-sm">
              <summary className="cursor-pointer text-suave">{resultado.ignorados.length} ativo(s) ficaram de fora</summary>
              <ul className="mt-2 space-y-1 text-xs text-suave">
                {resultado.ignorados.map((i) => (
                  <li key={i.codigo}><b className="text-texto">{i.codigo}</b>: {i.motivo}</li>
                ))}
              </ul>
            </details>
          )}

          {linhas.length > 0 && (
            <div className="space-y-3 rounded-lg bg-painel2 p-3">
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={modo === "atualizar"} onChange={() => setModo("atualizar")} className="accent-emerald-500" />
                  Só adicionar e atualizar (manter as outras)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={modo === "substituir"} onChange={() => setModo("substituir")} className="accent-emerald-500" />
                  Substituir a carteira pelo arquivo
                </label>
              </div>
              {removidas.length > 0 && (
                <p className="text-xs text-amber-300/90">
                  Serão removidas da carteira: {removidas.map((r) => r.ticker).join(", ")}
                </p>
              )}
              <button onClick={salvar} disabled={salvando || invalida || selecionadas.length === 0} className="botao">
                {salvando ? "Salvando…" : `Importar ${selecionadas.length} ativos`}
              </button>
              {invalida && <p className="text-xs text-baixa">Preencha o preço médio de todos os ativos marcados.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
