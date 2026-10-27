import type { Metadata } from "next";
import Link from "next/link";
import { brl, dataBr, pct } from "@/lib/format";
import { carregarPainel } from "@/lib/painel";
import { query } from "@/lib/db";
import { Logo } from "../Logo";
import { Cartao, Variacao } from "../ui";
import { removerAtivo, salvarAtivo } from "./actions";
import { ImportadorB3 } from "./ImportadorB3";
import { RegistrarOperacao } from "./RegistrarOperacao";
import { TipoAtivo } from "../TipoAtivo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Carteira" };

export default async function CarteiraPage() {
  const { posicoes, resumo } = await carregarPainel(); // também cria a tabela de operações
  const operacoes = await query<{ id: number; data: string; ticker: string; tipo: "C" | "V"; quantidade: number; preco: number }>(
    "select id, data, ticker, tipo, quantidade, preco from operacoes order by data desc, id desc limit 30",
  );
  const importador = <ImportadorB3 atual={posicoes.map((p) => ({ ticker: p.ticker, quantidade: p.quantidade, preco_medio: p.preco_medio }))} />;

  return (
    <div className="space-y-5">
      <div>
        <p className="rotulo">Cadastro</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Minha carteira</h1>
        <p className="mt-2 text-sm text-suave">As mudanças entram na próxima análise (às 7h ou pelo botão do painel).</p>
      </div>

      <Cartao titulo="Registrar compra ou venda">
        <RegistrarOperacao
          atual={posicoes.map((p) => ({ ticker: p.ticker, quantidade: p.quantidade, preco_medio: p.preco_medio, preco: p.a?.preco ?? null }))}
        />
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
                      <TipoAtivo tipo={p.a?.tipo} />
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

      {operacoes.length > 0 && (
        <Cartao titulo="Últimas compras e vendas">
          <div className="max-h-80 overflow-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Ativo</th>
                  <th>Operação</th>
                  <th className="!text-right">Quantidade</th>
                  <th className="!text-right">Preço</th>
                  <th className="!text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {operacoes.map((o) => (
                  <tr key={o.id}>
                    <td>{dataBr(o.data)}</td>
                    <td className="font-medium">{o.ticker}</td>
                    <td className={o.tipo === "C" ? "text-alta" : "text-baixa"}>{o.tipo === "C" ? "Compra" : "Venda"}</td>
                    <td className="text-right">{o.quantidade}</td>
                    <td className="text-right">{brl(o.preco)}</td>
                    <td className="text-right">{brl(o.quantidade * o.preco)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Cartao>
      )}

      <Cartao titulo="Importar da B3">{importador}</Cartao>

      <details className="cartao">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Corrigir posição à mão</summary>
        <form action={salvarAtivo} className="flex flex-wrap items-end gap-3 border-t border-borda p-4">
          <label className="flex flex-col gap-1">
            <span className="rotulo">Código</span>
            <input name="ticker" placeholder="PETR4" required className="campo w-28 uppercase" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="rotulo">Quantidade total</span>
            <input name="quantidade" inputMode="decimal" placeholder="100" required className="campo w-28" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="rotulo">Preço médio (R$)</span>
            <input name="preco_medio" inputMode="decimal" placeholder="25,40" required className="campo w-32" />
          </label>
          <button className="botao">Salvar</button>
          <p className="w-full text-xs text-fraco">
            Substitui a quantidade e o preço médio do ativo. Para uma compra nova, use “Registrar compra”, que calcula o preço médio sozinho.
          </p>
        </form>
      </details>
    </div>
  );
}
