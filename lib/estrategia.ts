// Qual estratégia vale hoje: a escolhida pelo usuário ou, no automático, Oportunidade nos primeiros meses da carteira.
import { migrar, query } from "./db";
import { LIMITE_SETOR, MESES_OPORTUNIDADE, type EscolhaEstrategia, type Estrategia } from "./modos";

export type InfoEstrategia = {
  escolha: EscolhaEstrategia;
  atual: Estrategia;
  inicio: string; // aaaa-mm-dd: início da carteira
  trocaEm: string; // aaaa-mm-dd: quando o automático passa para Balanceamento
  limiteSetor: number;
};

export async function estrategiaAtual(): Promise<InfoEstrategia> {
  await migrar();
  const cfg = new Map(
    (await query<{ chave: string; valor: string }>("select chave, valor from config where chave in ('estrategia', 'inicio_carteira')")).map(
      (c) => [c.chave, c.valor],
    ),
  );
  const e = cfg.get("estrategia");
  const escolha: EscolhaEstrategia = e === "oportunidade" || e === "balanceamento" ? e : "auto";

  // Início da carteira: a data guardada, senão a primeira compra lançada, senão hoje (e guarda para não mudar mais)
  let inicio = cfg.get("inicio_carteira");
  if (!inicio) {
    const [o] = await query<{ d: string | null }>(
      "select coalesce(min(data), (now() at time zone 'America/Sao_Paulo')::date)::text as d from operacoes",
    );
    inicio = o.d!;
    await query("insert into config (chave, valor) values ('inicio_carteira', $1) on conflict (chave) do nothing", [inicio]);
  }
  const [t] = await query<{ troca: string; antes: boolean }>(
    `select ($1::date + make_interval(months => $2::int))::date::text as troca,
            (now() at time zone 'America/Sao_Paulo')::date < ($1::date + make_interval(months => $2::int))::date as antes`,
    [inicio, MESES_OPORTUNIDADE],
  );
  const atual: Estrategia = escolha === "auto" ? (t.antes ? "oportunidade" : "balanceamento") : escolha;
  return { escolha, atual, inicio, trocaEm: t.troca, limiteSetor: LIMITE_SETOR[atual] };
}
