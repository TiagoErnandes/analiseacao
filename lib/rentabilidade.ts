// Rentabilidade por cotas (o método dos consolidadores): o retorno de cada dia desconta o dinheiro que entrou ou saiu,
// então um aporte grande não parece lucro e uma venda não parece prejuízo. Base: a foto diária do patrimônio.
// Fluxo do dia = variação do valor investido + lucro das vendas do período (a venda tira da carteira o valor de mercado,
// mas o investido cai só pelo preço médio). Os proventos do mês somam sobre o patrimônio do começo do mês.
import { query } from "./db";

type Foto = { data: string; investido: number; patrimonio: number };

export type MesRent = {
  mes: string; // AAAA-MM
  carteira: number;
  cdi: number | null;
  ibov: number | null;
  proventos: number; // em reais
};

export type Rentabilidade = {
  meses: MesRent[]; // até 12, do mais antigo ao mais novo
  acumulado: { carteira: number; cdi: number | null; ibov: number | null; desde: string } | null;
  serie: { data: string; carteira: number; cdi: number | null; ibov: number | null }[]; // acumulado dia a dia, para o gráfico
  ignorados: number; // dias com salto estranho (preço médio corrigido à mão, por exemplo), contados como 0%
};

/** Dia com variação acima disso quase sempre é ajuste de cadastro, não mercado. */
const SALTO = 0.4;

export async function rentabilidadeMensal(
  fotos: Foto[],
  lucros: { data: string; lucro: number }[],
  proventosPorMes: { mes: string; valor: number }[],
): Promise<Rentabilidade> {
  const vazio: Rentabilidade = { meses: [], acumulado: null, serie: [], ignorados: 0 };
  const validas = fotos.filter((f) => f.patrimonio > 0 || f.investido > 0);
  if (validas.length < 2) return vazio;

  // Retorno de cada dia (entre duas fotos)
  let ignorados = 0;
  const dias: { de: string; ate: string; r: number }[] = [];
  for (let i = 1; i < validas.length; i++) {
    const a = validas[i - 1];
    const b = validas[i];
    const realizado = lucros.filter((l) => l.data > a.data && l.data <= b.data).reduce((s, l) => s + l.lucro, 0);
    const base = a.patrimonio + (b.investido - a.investido) + realizado;
    if (!(base > 0)) continue;
    let r = b.patrimonio / base - 1;
    if (Math.abs(r) > SALTO) {
      ignorados++;
      r = 0;
    }
    dias.push({ de: a.data, ate: b.data, r });
  }
  if (!dias.length) return vazio;

  const mesesTodos = [...new Set(dias.map((d) => d.ate.slice(0, 7)))].slice(-12);
  const primeiroDia = dias.find((d) => d.ate.startsWith(mesesTodos[0]))!;
  const desde = primeiroDia.de;
  const indices = await query<{ serie: string; data: string; valor: number }>(
    "select serie, data::text, valor from indices where serie in ('cdi', 'ibov') and data >= ($1::date - 10) order by data",
    [desde],
  );
  const cdi = indices.filter((i) => i.serie === "cdi");
  const ibov = indices.filter((i) => i.serie === "ibov");
  const cdiEntre = (de: string, ate: string) => {
    const d = cdi.filter((x) => x.data > de && x.data <= ate);
    return d.length ? d.reduce((f, x) => f * (1 + x.valor / 100), 1) - 1 : null;
  };
  const ibovAte = (data: string) => [...ibov].reverse().find((x) => x.data <= data)?.valor ?? null;
  const ibovEntre = (de: string, ate: string) => {
    const a = ibovAte(de);
    const b = ibovAte(ate);
    return a && b ? b / a - 1 : null;
  };
  const patrimonioEm = (data: string) => validas.find((f) => f.data === data)?.patrimonio ?? 0;

  const meses: MesRent[] = mesesTodos.map((mes) => {
    const doMes = dias.filter((d) => d.ate.startsWith(mes));
    const inicio = doMes[0].de;
    const fim = doMes.at(-1)!.ate;
    const twr = doMes.reduce((f, d) => f * (1 + d.r), 1) - 1;
    const proventos = proventosPorMes.find((p) => p.mes === mes)?.valor ?? 0;
    const base = patrimonioEm(inicio);
    return {
      mes,
      carteira: twr + (base > 0 ? proventos / base : 0),
      cdi: cdiEntre(inicio, fim),
      ibov: ibovEntre(inicio, fim),
      proventos,
    };
  });

  // Série acumulada dia a dia (os proventos entram no último dia de cada mês)
  const serie: Rentabilidade["serie"] = [{ data: desde, carteira: 0, cdi: 0, ibov: 0 }];
  let f = 1;
  for (const m of meses) {
    const doMes = dias.filter((d) => d.ate.startsWith(m.mes));
    const twr = doMes.reduce((x, d) => x * (1 + d.r), 1) - 1;
    const extra = m.carteira - twr;
    doMes.forEach((d, i) => {
      f *= 1 + d.r;
      if (i === doMes.length - 1) f *= 1 + extra / (1 + twr || 1);
      serie.push({ data: d.ate, carteira: f - 1, cdi: cdiEntre(desde, d.ate), ibov: ibovEntre(desde, d.ate) });
    });
  }

  const fim = dias.at(-1)!.ate;
  return {
    meses,
    acumulado: { carteira: meses.reduce((x, m) => x * (1 + m.carteira), 1) - 1, cdi: cdiEntre(desde, fim), ibov: ibovEntre(desde, fim), desde },
    serie,
    ignorados,
  };
}
