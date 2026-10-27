import type { Metadata } from "next";
import Link from "next/link";
import { brl, pct } from "@/lib/format";
import { carregarPainel } from "@/lib/painel";
import { Logo } from "../Logo";
import { Cartao, Variacao } from "../ui";
import { removerAtivo, salvarAtivo } from "./actions";
import { ImportadorB3 } from "./ImportadorB3";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Carteira" };

export default async function CarteiraPage() {
  const { posicoes, resumo } = await carregarPainel();

  return (
    <div className="space-y-5">
      <div>
        <p className="rotulo">Cadastro</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Minha carteira</h1>
        <p className="mt-2 text-sm text-suave">As mudanças entram na próxima análise (às 7h ou pelo botão do painel).</p>
      </div>

      <Cartao titulo="Importar da B3">
        <ImportadorB3 atual={posicoes.map((p) => ({ ticker: p.ticker, quantidade: p.quantidade, preco_medio: p.preco_medio }))} />
      </Cartao>

      <Cartao titulo="Adicionar ou atualizar à mão">
        <form action={salvarAtivo} className="flex flex-wrap items-end gap-3 p-4">
          <label className="flex flex-col gap-1">
            <span className="rotulo">Código</span>
            <input name="ticker" placeholder="PETR4" required className="campo w-28 uppercase" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="rotulo">Quantidade</span>
            <input name="quantidade" inputMode="decimal" placeholder="100" required className="campo w-28" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="rotulo">Preço médio (R$)</span>
            <input name="preco_medio" inputMode="decimal" placeholder="25,40" required className="campo w-32" />
          </label>
          <button className="botao">Salvar</button>
          <p className="w-full text-xs text-fraco">Para editar, digite o mesmo código com os novos valores.</p>
        </form>
      </Cartao>

      <Cartao titulo={<>Ativos <span className="ml-1 font-normal text-fraco">{posicoes.length}</span></>}>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Ativo</th>
                <th className="!text-right">Quantidade</th>
                <th className="!text-right">Preço médio</th>
                <th className="!text-right">Investido</th>
                <th className="!text-right">Posição atual</th>
                <th className="!text-right">Rentab.</th>
                <th className="!text-right">Peso</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {posicoes.map((p) => (
                <tr key={p.ticker}>
                  <td>
                    <Link href={`/acao/${p.ticker}`} className="flex items-center gap-2.5 font-medium hover:text-marca">
                      <Logo ticker={p.ticker} src={p.a?.logo} />
                      {p.ticker}
                    </Link>
                  </td>
                  <td className="text-right">{p.quantidade}</td>
                  <td className="text-right">{brl(p.preco_medio)}</td>
                  <td className="text-right">{brl(p.investido)}</td>
                  <td className="text-right">{brl(p.valor)}</td>
                  <td className="text-right"><Variacao v={p.rentabilidade} /></td>
                  <td className="text-right">{pct(p.peso)}</td>
                  <td className="text-right">
                    <form action={removerAtivo}>
                      <input type="hidden" name="ticker" value={p.ticker} />
                      <button className="rounded-md px-2 py-1 text-xs text-baixa hover:bg-baixa/10">Remover</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-borda bg-painel2 text-sm font-semibold tabular-nums">
                <td className="px-3 py-2.5">Total</td>
                <td />
                <td />
                <td className="px-3 py-2.5 text-right">{brl(resumo.investido)}</td>
                <td className="px-3 py-2.5 text-right">{brl(resumo.patrimonio)}</td>
                <td className="px-3 py-2.5 text-right"><Variacao v={resumo.rentabilidade} /></td>
                <td className="px-3 py-2.5 text-right">100%</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Cartao>
    </div>
  );
}
