// Painel: as 3 maiores altas e as 3 maiores quedas do dia entre os ativos da carteira, em % e em reais.
import Link from "next/link";
import type { Posicao } from "@/lib/painel";
import { brl, dinheiro } from "@/lib/format";
import { Logo } from "./Logo";
import { Cartao, Variacao } from "./ui";

type Movimento = {
  p: Posicao;
  v: number; // variação do dia (0,012 = +1,2%)
  porCota: number; // quanto cada ação/cota andou hoje, na moeda do ativo
  naPosicao: number; // quanto a sua posição ganhou ou perdeu hoje, em reais
};

const sinal = (v: number, txt: string) => (v > 0 ? `+${txt}` : v < 0 ? txt.replace(/^-?/, "−") : txt);

function Lista({ titulo, itens, cor }: { titulo: string; itens: Movimento[]; cor: "alta" | "baixa" }) {
  return (
    <div className="min-w-0">
      <p className={`rotulo px-4 pt-3 ${cor === "alta" ? "!text-alta" : "!text-baixa"}`}>{titulo}</p>
      {itens.length === 0 ? (
        <p className="px-4 py-3 text-sm text-fraco">{cor === "alta" ? "Nenhum ativo subiu hoje." : "Nenhum ativo caiu hoje."}</p>
      ) : (
        <ul className="divide-y divide-borda">
          {itens.map(({ p, v, porCota, naPosicao }) => (
            <li key={p.ticker}>
              <Link href={`/acao/${p.ticker}`} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-painel2/60">
                <Logo ticker={p.ticker} src={p.a?.logo} />
                <div className="min-w-0">
                  <p className="font-medium">{p.ticker}</p>
                  <p className="text-xs text-fraco tabular-nums" title="Quanto cada ação/cota subiu ou caiu hoje">
                    {sinal(porCota, dinheiro(Math.abs(porCota), p.moeda))} por cota · {dinheiro(p.a?.preco, p.moeda)}
                  </p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-sm font-semibold"><Variacao v={v} casas={2} seta /></p>
                  <p className={`text-xs font-medium tabular-nums ${naPosicao >= 0 ? "text-alta" : "text-baixa"}`} title="Quanto a sua posição ganhou ou perdeu hoje">
                    {sinal(naPosicao, brl(Math.abs(naPosicao)))}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AltasQuedas({ posicoes, quantos = 3 }: { posicoes: Posicao[]; quantos?: number }) {
  const movimentos: Movimento[] = posicoes
    .filter((p) => p.tipo !== "renda_fixa" && p.a?.variacao_dia != null && p.a.preco != null && p.valor > 0)
    .map((p) => {
      const v = p.a!.variacao_dia!;
      const fator = v / (1 + v); // preço de hoje × fator = quanto andou desde o fechamento de ontem
      return { p, v, porCota: p.a!.preco! * fator, naPosicao: p.valor * fator };
    });
  if (movimentos.length === 0) return null;
  const altas = movimentos.filter((m) => m.v > 0).sort((a, b) => b.v - a.v).slice(0, quantos);
  const quedas = movimentos.filter((m) => m.v < 0).sort((a, b) => a.v - b.v).slice(0, quantos);
  const saldo = movimentos.reduce((s, m) => s + m.naPosicao, 0);
  return (
    <Cartao
      titulo="Maiores altas e quedas do dia na carteira"
      acao={
        <span className="text-xs text-fraco" title="Soma do que todas as posições de renda variável ganharam ou perderam hoje">
          Saldo do dia <b className={`tabular-nums ${saldo >= 0 ? "text-alta" : "text-baixa"}`}>{sinal(saldo, brl(Math.abs(saldo)))}</b>
        </span>
      }
    >
      <div className="grid pb-1 sm:grid-cols-2 sm:divide-x sm:divide-borda">
        <Lista titulo="▲ Maiores altas" itens={altas} cor="alta" />
        <Lista titulo="▼ Maiores quedas" itens={quedas} cor="baixa" />
      </div>
    </Cartao>
  );
}
