// Referências para comparar a carteira: CDI e IPCA (Banco Central, grátis) e Ibovespa (Yahoo).
import { query } from "./db";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; analiseacao/1.0)" };
type Ponto = { data: string; valor: number };

const brParaIso = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
const isoParaBr = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "UTC" });

/** Série do Banco Central (SGS): 12 = CDI ao dia (%), 433 = IPCA do mês (%). */
async function sgs(codigo: number, desde: Date): Promise<Ponto[]> {
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados?formato=json&dataInicial=${isoParaBr(desde)}&dataFinal=${isoParaBr(new Date())}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Banco Central série ${codigo}: HTTP ${res.status}`);
  const json = (await res.json()) as { data: string; valor: string }[];
  return json.map((p) => ({ data: brParaIso(p.data), valor: Number.parseFloat(p.valor) })).filter((p) => Number.isFinite(p.valor));
}

/** Fechamento diário do Ibovespa no último ano e meio. */
async function ibovespa(): Promise<Ponto[]> {
  const res = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/%5EBVSP?range=2y&interval=1d", { headers: UA });
  if (!res.ok) throw new Error(`Yahoo Ibovespa: HTTP ${res.status}`);
  const r = ((await res.json()) as any)?.chart?.result?.[0];
  const close: (number | null)[] = r?.indicators?.quote?.[0]?.close ?? [];
  return ((r?.timestamp ?? []) as number[])
    .map((t, i) => ({ data: new Date(t * 1000).toISOString().slice(0, 10), valor: close[i] as number }))
    .filter((p) => typeof p.valor === "number" && p.valor > 0);
}

/** Baixa e guarda as séries. Falha de uma fonte não derruba a análise. */
export async function atualizarIndices(): Promise<string[]> {
  const desde = new Date();
  desde.setMonth(desde.getMonth() - 26);
  const erros: string[] = [];
  const fontes: [string, () => Promise<Ponto[]>][] = [
    ["cdi", () => sgs(12, desde)],
    ["ipca", () => sgs(433, desde)],
    ["ibov", ibovespa],
  ];
  for (const [serie, buscar] of fontes) {
    try {
      const pontos = await buscar();
      for (const p of pontos) {
        await query(
          "insert into indices (serie, data, valor) values ($1, $2, $3) on conflict (serie, data) do update set valor = excluded.valor",
          [serie, p.data, p.valor],
        );
      }
    } catch (err) {
      erros.push(`${serie}: ${(err as Error).message}`);
    }
  }
  return erros;
}

export type Comparativo = { desde: string; cdi: number | null; ipca: number | null; ibov: number | null };

/** Quanto cada referência rendeu de `desde` até hoje (em fração). */
export async function compararDesde(desde: string): Promise<Comparativo> {
  const linhas = await query<{ serie: string; data: string; valor: number }>(
    "select serie, data::text, valor from indices where data >= ($1::date - 10) order by data",
    [desde],
  );
  const de = (s: string) => linhas.filter((l) => l.serie === s);

  // CDI: juros compostos dos dias depois de `desde`
  const cdiDias = de("cdi").filter((l) => l.data > desde);
  const cdi = cdiDias.length ? cdiDias.reduce((f, l) => f * (1 + l.valor / 100), 1) - 1 : null;

  // IPCA: meses inteiros depois do mês de `desde` (o dado vem com o 1º dia do mês)
  const mesDesde = `${desde.slice(0, 7)}-01`;
  const ipcaMeses = de("ipca").filter((l) => l.data > mesDesde);
  const ipca = ipcaMeses.length ? ipcaMeses.reduce((f, l) => f * (1 + l.valor / 100), 1) - 1 : null;

  // Ibovespa: último fechamento até `desde` contra o mais recente
  const ibovs = de("ibov");
  const base = [...ibovs].reverse().find((l) => l.data <= desde) ?? ibovs[0];
  const ultimo = ibovs[ibovs.length - 1];
  const ibov = base && ultimo && ultimo.data > base.data ? ultimo.valor / base.valor - 1 : null;

  return { desde, cdi, ipca, ibov };
}
