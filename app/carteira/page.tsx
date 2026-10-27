import { brl } from "@/lib/format";
import { db, type Carteira } from "@/lib/supabase";
import { removerAtivo, salvarAtivo } from "./actions";

export const dynamic = "force-dynamic";

const input = "rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm";

export default async function CarteiraPage() {
  const { data } = await db().from("carteira").select("ticker, quantidade, preco_medio").order("ticker");
  const carteira = (data ?? []) as Carteira[];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Minha carteira</h1>

      <form action={salvarAtivo} className="flex flex-wrap items-end gap-3 rounded-xl border border-neutral-800 p-4">
        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          Código
          <input name="ticker" placeholder="PETR4" required className={`${input} w-28 uppercase`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          Quantidade
          <input name="quantidade" inputMode="decimal" required className={`${input} w-28`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          Preço médio (R$)
          <input name="preco_medio" inputMode="decimal" required className={`${input} w-32`} />
        </label>
        <button className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500">
          Adicionar / atualizar
        </button>
        <p className="w-full text-xs text-neutral-500">Para editar, digite o mesmo código com os novos valores.</p>
      </form>

      <div className="overflow-x-auto rounded-xl border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-left text-neutral-400">
            <tr>
              <th className="px-3 py-2 font-medium">Ativo</th>
              <th className="px-3 py-2 font-medium">Quantidade</th>
              <th className="px-3 py-2 font-medium">Preço médio</th>
              <th className="px-3 py-2 font-medium">Investido</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {carteira.map((c) => (
              <tr key={c.ticker} className="border-t border-neutral-800">
                <td className="px-3 py-2 font-medium">{c.ticker}</td>
                <td className="px-3 py-2">{c.quantidade}</td>
                <td className="px-3 py-2">{brl(c.preco_medio)}</td>
                <td className="px-3 py-2">{brl(c.quantidade * c.preco_medio)}</td>
                <td className="px-3 py-2 text-right">
                  <form action={removerAtivo}>
                    <input type="hidden" name="ticker" value={c.ticker} />
                    <button className="text-xs text-red-400 hover:underline">Remover</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-500">As mudanças entram na próxima análise da manhã.</p>
    </div>
  );
}
