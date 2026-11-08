import type { Metadata } from "next";
import Link from "next/link";
import { brl, dataBr, dinheiro, num } from "@/lib/format";
import { exigirUsuario } from "@/lib/auth";
import { apurarIr, bensEDireitos, type Bem, type Mes } from "@/lib/ir";
import { infoTipo } from "@/lib/tipos";
import { Cartao, Kpi, Vazio } from "../ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Imposto de renda" };

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const nomeMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;

function Valor({ v, zero = "—" }: { v: number; zero?: string }) {
  if (Math.abs(v) < 0.005) return <span className="text-fraco">{zero}</span>;
  return <span className={v > 0 ? "text-alta" : "text-baixa"}>{brl(v)}</span>;
}

/** Texto pronto para o campo "Discriminação" da ficha Bens e Direitos. */
function discriminacao(b: Bem, ano: number) {
  if (b.tipo === "renda_fixa") return `${b.ticker}. Valor aplicado. Instituição: (informe o banco ou a corretora e o CNPJ).`;
  const tipo = infoTipo(b.tipo)?.curto ?? "Ativo";
  const qtd = b.quantidade || b.quantidadeAnterior;
  const unidade = b.tipo === "fii" || b.tipo === "etf" ? "cotas" : b.tipo === "cripto" ? "unidades" : "ações";
  const pm = qtd > 0 ? (b.quantidade ? b.custo / b.quantidade : b.custoAnterior / b.quantidadeAnterior) : 0;
  const base = `${num(b.quantidade, b.tipo === "cripto" ? 8 : 0)} ${unidade} de ${b.ticker}${b.nome ? ` (${b.nome})` : ""} - ${tipo}, preço médio de ${dinheiro(pm, b.moeda)}`;
  if (b.quantidade === 0) return `${b.ticker}: posição vendida durante ${ano}.`;
  return `${base}. Corretora: (informe o nome e o CNPJ).`;
}

function LinhaMes({ m }: { m: Mes }) {
  return (
    <tr>
      <td className="font-medium">
        <details>
          <summary className="cursor-pointer">{nomeMes(m.mes)}</summary>
          <ul className="mt-2 space-y-1 text-xs font-normal text-suave">
            {m.vendas.map((v, i) => (
              <li key={i}>
                {dataBr(v.data)} · {v.ticker} · {num(v.quantidade, v.tipo === "cripto" ? 8 : 0)} por {brl(v.valor)} ·{" "}
                <span className={v.lucro >= 0 ? "text-alta" : "text-baixa"}>{v.lucro >= 0 ? "lucro" : "prejuízo"} {brl(Math.abs(v.lucro))}</span>
                {v.estimado && <span className="text-amber-300" title="Preço médio reconstruído pelo cadastro da carteira"> (estimado)</span>}
              </li>
            ))}
          </ul>
        </details>
      </td>
      <td className="text-right">
        {m.vendasAcoes > 0 ? brl(m.vendasAcoes) : <span className="text-fraco">—</span>}
        {m.vendasAcoes > 0 && m.isentoAcoes && <span className="ml-1 rounded bg-alta/10 px-1 text-[10px] font-semibold text-alta">ISENTO</span>}
      </td>
      <td className="text-right"><Valor v={m.lucroAcoes} /></td>
      <td className="text-right"><Valor v={m.lucroComum} /></td>
      <td className="text-right"><Valor v={m.lucroFii} /></td>
      <td className="text-right"><Valor v={m.lucroCripto} /></td>
      <td className="text-right text-suave">{m.prejuizoComumUsado + m.prejuizoFiiUsado > 0 ? brl(m.prejuizoComumUsado + m.prejuizoFiiUsado) : "—"}</td>
      <td className="text-right font-semibold">{m.darf > 0 ? brl(m.darf) : <span className="font-normal text-fraco">{m.imposto > 0 ? "abaixo de R$ 10" : "—"}</span>}</td>
      <td className="text-right">{m.vencimento ? dataBr(m.vencimento) : <span className="text-fraco">—</span>}</td>
    </tr>
  );
}

export default async function ImpostoDeRenda({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  const usuario = await exigirUsuario();
  const anoAtual = new Date().getFullYear();
  const ir = await apurarIr(usuario.id);
  const pedido = Number((await searchParams).ano);
  const anos = [...new Set([anoAtual, anoAtual - 1, ...ir.anos])].filter((a) => a <= anoAtual).sort((a, b) => b - a);
  const ano = anos.includes(pedido) ? pedido : anoAtual - 1;
  const { bens, rendaFixa } = await bensEDireitos(usuario.id, ano);

  const hoje = new Date().toISOString().slice(0, 10);
  const aPagar = ir.meses.filter((m) => m.darf > 0 && (m.vencimento ?? "") >= hoje);
  const doAno = ir.meses.filter((m) => m.mes.startsWith(String(ano)));
  const isentoAno = doAno.filter((m) => m.isentoAcoes && m.lucroAcoes > 0).reduce((s, m) => s + m.lucroAcoes, 0);
  const impostoAno = doAno.reduce((s, m) => s + m.darf, 0);
  const exterior = ir.vendas.filter((v) => v.grupo === "exterior" && v.data.startsWith(String(ano)));
  const lucroExterior = exterior.reduce((s, v) => s + v.lucro, 0);
  const todosBens = [...bens, ...rendaFixa];

  return (
    <div className="space-y-5">
      <div>
        <p className="rotulo">Vendas, DARF e declaração anual</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Imposto de renda</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-suave">
          Calculado pelas compras e vendas lançadas ou importadas da B3 (arquivo de Negociação). Ações: isento quando as vendas de ações no
          mês somam até R$ 20 mil; acima disso, 15% sobre o lucro. ETFs e BDRs pagam 15% sem isenção, FIIs 20%. Prejuízo de meses anteriores é
          descontado do lucro (o de FII só do lucro de FII). DARF código <b className="text-texto">6015</b>, até o último dia útil do mês seguinte.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          rotulo="DARF a pagar"
          valor={aPagar.length ? brl(aPagar.reduce((s, m) => s + m.darf, 0)) : <span className="text-alta">Nada</span>}
          detalhe={aPagar.length ? `vence em ${dataBr(aPagar.at(-1)!.vencimento!)} (código 6015)` : "nenhum imposto em aberto"}
        />
        <Kpi
          rotulo="Prejuízo a compensar"
          valor={brl(ir.prejuizoComum + ir.prejuizoFii)}
          detalhe={<p>Ações/ETF/BDR {brl(ir.prejuizoComum)} · FII {brl(ir.prejuizoFii)}</p>}
          dica="Prejuízo acumulado nas vendas, descontado do lucro dos próximos meses. Informe na declaração anual para não perder."
        />
        <Kpi rotulo={`Lucro isento em ${ano}`} valor={brl(isentoAno)} detalhe="vendas de ações até R$ 20 mil no mês" dica="Vai em Rendimentos Isentos na declaração" />
        <Kpi rotulo={`DARFs de ${ano}`} valor={brl(impostoAno)} detalhe={`${doAno.filter((m) => m.darf > 0).length} mês(es) com imposto`} />
      </section>

      <Cartao titulo="Apuração mês a mês">
        {ir.meses.length === 0 ? (
          <p className="p-4 text-sm text-suave">
            Nenhuma venda lançada. Quando você vender, lance a venda na <Link href="/carteira" className="text-marca hover:underline">Carteira</Link> ou
            importe o arquivo de Negociação da B3, e o lucro, a isenção e o DARF aparecem aqui.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th className="!text-right">Vendas de ações</th>
                  <th className="!text-right">Lucro ações</th>
                  <th className="!text-right">ETF e BDR</th>
                  <th className="!text-right">FII</th>
                  <th className="!text-right">Cripto</th>
                  <th className="!text-right">Prejuízo usado</th>
                  <th className="!text-right">DARF</th>
                  <th className="!text-right">Vencimento</th>
                </tr>
              </thead>
              <tbody>{ir.meses.map((m) => <LinhaMes key={m.mes} m={m} />)}</tbody>
            </table>
          </div>
        )}
        <p className="border-t border-borda px-4 py-3 text-xs text-fraco">
          Clique no mês para ver cada venda. O DARF já desconta o IRRF de 0,005% retido pela corretora. Imposto abaixo de R$ 10 fica para o
          mês seguinte. Criptomoedas: isento até R$ 35 mil de vendas no mês, 15% acima disso.
        </p>
      </Cartao>

      <Cartao
        titulo={`Bens e Direitos em 31/12/${ano}`}
        acao={
          <div className="flex flex-wrap gap-1.5">
            {anos.map((a) => (
              <Link key={a} href={`/ir?ano=${a}`} className={`chip ${a === ano ? "chip-ativo" : ""}`}>{a}</Link>
            ))}
          </div>
        }
      >
        {todosBens.length === 0 ? (
          <div className="p-4"><Vazio>Nenhum ativo na carteira em 31/12/{ano}.</Vazio></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Grupo-código</th>
                  <th>Ativo</th>
                  <th>Discriminação (sugestão)</th>
                  <th className="!text-right">31/12/{ano - 1}</th>
                  <th className="!text-right">31/12/{ano}</th>
                </tr>
              </thead>
              <tbody>
                {todosBens.map((b) => (
                  <tr key={b.ticker}>
                    <td className="text-suave">{b.codigo === "exterior" ? "04 ou 07 (exterior)" : b.codigo}</td>
                    <td className="font-medium">{b.ticker}</td>
                    <td className="min-w-72 !whitespace-normal text-xs text-suave">{discriminacao(b, ano)}</td>
                    <td className="text-right">{dinheiro(b.custoAnterior, b.moeda)}</td>
                    <td className="text-right font-semibold">{dinheiro(b.custo, b.moeda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-borda px-4 py-3 text-xs text-fraco">
          A Receita pede o <b>custo de aquisição</b> (quantidade × preço médio), não o valor de mercado. Renda fixa aparece pelo valor aplicado;
          use o informe do banco para o saldo exato. Ativos no exterior estão em dólar: converta pela cotação de compra do Banco Central de cada
          compra. Confira os códigos no programa da Receita do ano.
        </p>
      </Cartao>

      {exterior.length > 0 && (
        <Cartao titulo={`Exterior em ${ano} (declaração anual)`}>
          <div className="space-y-2 p-4 text-sm">
            <p>
              Lucro nas vendas de stocks, ETFs internacionais e REITs: <b className={lucroExterior >= 0 ? "text-alta" : "text-baixa"}>{dinheiro(lucroExterior, "USD")}</b>{" "}
              em {exterior.length} venda(s).
            </p>
            <p className="text-xs text-fraco">
              Desde 2024 (Lei 14.754/2023) o ganho no exterior paga 15% uma vez por ano, na declaração, sem DARF mensal e sem isenção. Os
              valores estão em dólar; a conversão para reais usa a cotação de cada compra e venda.
            </p>
          </div>
        </Cartao>
      )}

      {ir.avisos.length > 0 && (
        <Cartao titulo="Confira">
          <ul className="space-y-1.5 p-4 text-xs text-amber-200/90">
            {ir.avisos.map((a) => <li key={a}>⚠ {a}</li>)}
          </ul>
        </Cartao>
      )}

      <p className="text-xs text-fraco">
        Ferramenta de apoio. Proventos (dividendos isentos e JCP com IR na fonte) vêm no informe de rendimentos da corretora. Na dúvida,
        confirme com um contador.
      </p>
    </div>
  );
}
