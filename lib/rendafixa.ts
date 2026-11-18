// Renda fixa e outros bens sem cotação (CDB, caixinha de banco, Tesouro, LCI, imóvel, negócio próprio).
// Cada "cota" vale R$ 1 na data da aplicação; o preço de hoje é o fator acumulado pelo indexador:
//  - cdi: fração do CDI diário (série 12 do Banco Central, tabela indices)
//  - pre: taxa prefixada ao ano, por dia útil (252 dias; os dias úteis são os dias com CDI publicado)
//  - ipca: IPCA mensal (série 433) + taxa real ao ano por dia útil
// Aplicar mais ou resgatar muda o número de cotas pelo fator do dia (como comprar e vender a preço de cota).
import { query } from "./db";
import { indexadorDe, type PosicaoRf } from "./rendafixaInfo";

export * from "./rendafixaInfo";

export type CdiDia = { data: string; valor: number }; // valor: % ao dia
export type IpcaMes = { data: string; valor: number }; // data: 1º dia do mês; valor: % no mês
export type SeriesRf = { cdi: CdiDia[]; ipca: IpcaMes[] };

/** Séries do Banco Central que as posições precisam, desde a aplicação mais antiga. */
export async function carregarSeriesRf(posicoes: PosicaoRf[]): Promise<SeriesRf> {
  const rf = posicoes.filter((p) => p.tipo === "renda_fixa" && p.data_aplicacao);
  const desde = rf.map((p) => p.data_aplicacao as string).sort()[0];
  if (!desde) return { cdi: [], ipca: [] };
  const precisaIpca = rf.some((p) => indexadorDe(p) === "ipca");
  const [cdi, ipca] = await Promise.all([
    query<CdiDia>("select data::text, valor from indices where serie = 'cdi' and data > $1 order by data", [desde]),
    precisaIpca
      ? query<IpcaMes>("select data::text, valor from indices where serie = 'ipca' and data >= date_trunc('month', $1::date) order by data", [desde])
      : Promise.resolve([] as IpcaMes[]),
  ]);
  return { cdi, ipca };
}

/** Compatível com o código antigo: só a série do CDI. */
export async function serieCdi(desde: string | null): Promise<CdiDia[]> {
  if (!desde) return [];
  return query<CdiDia>("select data::text, valor from indices where serie = 'cdi' and data > $1 order by data", [desde]);
}

/** Fator acumulado desde `desde` (exclusive) rendendo `taxa` × CDI, até `ate` (inclusive) se informado. */
export function fatorCdi(cdi: CdiDia[], desde: string | null | undefined, taxa: number | null | undefined, ate?: string | null): number {
  if (!desde || !taxa) return 1;
  let f = 1;
  for (const d of cdi) if (d.data > desde && (!ate || d.data <= ate)) f *= 1 + (d.valor / 100) * taxa;
  return f;
}

/** Dias úteis entre `desde` (exclusive) e `ate` (inclusive), contados pelos dias com CDI publicado. */
function diasUteis(cdi: CdiDia[], desde: string, ate: string | null): number {
  let n = 0;
  for (const d of cdi) if (d.data > desde && (!ate || d.data <= ate)) n++;
  return n;
}

/**
 * Fator de uma posição entre a aplicação e `ate` (hoje, se vazio). O rendimento para no vencimento.
 * Ex.: 1,0834 = cada R$ 1 aplicado vale R$ 1,0834.
 */
export function fatorPosicao(s: SeriesRf, p: PosicaoRf, ate?: string | null): number {
  const desde = p.data_aplicacao;
  if (!desde) return 1;
  let fim = ate ?? null;
  if (p.vencimento && (!fim || p.vencimento < fim)) fim = p.vencimento;
  if (fim && fim <= desde) return 1;
  const ix = indexadorDe(p);
  if (ix === "cdi") return fatorCdi(s.cdi, desde, p.taxa_cdi, fim);
  const real = Math.pow(1 + (p.taxa_anual ?? 0), diasUteis(s.cdi, desde, fim) / 252);
  if (ix === "pre") return real;
  // IPCA: meses inteiros depois do mês da aplicação, até o mês de `fim` (o IPCA sai com um mês de atraso)
  const mesDesde = `${desde.slice(0, 7)}-01`;
  const mesFim = fim ? `${fim.slice(0, 7)}-01` : null;
  let inflacao = 1;
  for (const m of s.ipca) if (m.data > mesDesde && (!mesFim || m.data <= mesFim)) inflacao *= 1 + m.valor / 100;
  return inflacao * real;
}

/** Preço de hoje (fator) de cada posição de renda fixa, na mesma ordem e com a mesma chave que `chave` devolver. */
export async function precosRendaFixa<T extends PosicaoRf & { ticker: string }>(
  posicoes: T[],
  chave: (p: T) => string = (p) => p.ticker,
): Promise<Map<string, number>> {
  const r = new Map<string, number>();
  const rf = posicoes.filter((p) => p.tipo === "renda_fixa");
  if (!rf.length) return r;
  const series = await carregarSeriesRf(rf);
  for (const p of rf) r.set(chave(p), fatorPosicao(series, p));
  return r;
}

/** IR regressivo da renda fixa: 22,5% até 180 dias, 20% até 360, 17,5% até 720 e 15% depois. */
export function aliquotaIr(dias: number): number {
  if (dias <= 180) return 0.225;
  if (dias <= 360) return 0.2;
  if (dias <= 720) return 0.175;
  return 0.15;
}

/**
 * Valor líquido estimado se resgatar hoje: desconta o IR sobre o rendimento pela idade da aplicação
 * (com aportes depois, é uma aproximação; o IOF dos primeiros 30 dias fica de fora). Isento (LCI, LCA): o próprio valor.
 */
export function liquidoEstimado(valor: number, investido: number, desde: string | null | undefined, isento: boolean | null | undefined, hoje = new Date()): { liquido: number; ir: number; aliquota: number } {
  const ganho = valor - investido;
  if (isento || ganho <= 0 || !desde) return { liquido: valor, ir: 0, aliquota: 0 };
  const dias = Math.floor((hoje.getTime() - new Date(`${desde}T12:00:00Z`).getTime()) / 86_400_000);
  const aliquota = aliquotaIr(dias);
  const ir = ganho * aliquota;
  return { liquido: valor - ir, ir, aliquota };
}
