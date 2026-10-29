// Juro real de longo prazo (o que o Tesouro IPCA+ paga acima da inflação). É a referência do preço teto:
// se o título público sem risco paga 7% acima do IPCA, um dividendo de 6% não compensa o risco da ação.
import { query } from "./db";
import { lerCache, salvarCache } from "./mercado";

export type JuroReal = { taxa: number; fonte: string; data: string };

const UA = { "User-Agent": "Mozilla/5.0 (compatible; analiseacao/1.0)" };
const CSV_TESOURO =
  "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv";

const dataBr = (s: string) => {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : NaN;
};
const mediana = (v: number[]) => {
  const o = [...v].sort((a, b) => a - b);
  return o.length % 2 ? o[(o.length - 1) / 2] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2;
};

/** Mediana das taxas do Tesouro IPCA+ que vencem em 5 anos ou mais, no último dia do arquivo do Tesouro. */
export function juroRealDoCsv(csv: string): JuroReal | null {
  const linhas = csv.split(/\r?\n/);
  const cab = linhas[0].split(";").map((c) => c.trim().toLowerCase());
  const col = (nome: string) => cab.findIndex((c) => c.includes(nome));
  const [iTipo, iVenc, iBase, iCompra, iVenda] = [col("tipo"), col("vencimento"), col("data base"), col("taxa compra"), col("taxa venda")];
  if ([iTipo, iVenc, iBase, iCompra].some((i) => i < 0)) return null;
  const linhasIpca = linhas
    .slice(1)
    .map((l) => l.split(";"))
    .filter((c) => /ipca\+/i.test(c[iTipo] ?? "") && !/renda|educa/i.test(c[iTipo] ?? ""));
  const ultima = Math.max(...linhasIpca.map((c) => dataBr(c[iBase])).filter(Number.isFinite));
  if (!Number.isFinite(ultima)) return null;
  const cincoAnos = ultima + 5 * 365 * 86_400_000;
  const taxas = linhasIpca
    .filter((c) => dataBr(c[iBase]) === ultima && dataBr(c[iVenc]) >= cincoAnos)
    .map((c) => {
      const compra = Number.parseFloat((c[iCompra] ?? "").replace(",", "."));
      const venda = iVenda >= 0 ? Number.parseFloat((c[iVenda] ?? "").replace(",", ".")) : NaN;
      return compra > 0 ? compra : venda; // título fora de venda tem taxa de compra zerada
    })
    .filter((t) => t > 0 && t < 30);
  if (!taxas.length) return null;
  return { taxa: mediana(taxas) / 100, fonte: "Tesouro IPCA+ (5 anos ou mais)", data: new Date(ultima).toISOString().slice(0, 10) };
}

async function doTesouro(): Promise<JuroReal | null> {
  const res = await fetch(CSV_TESOURO, { headers: UA });
  if (!res.ok) throw new Error(`Tesouro: HTTP ${res.status}`);
  return juroRealDoCsv(new TextDecoder("latin1").decode(await res.arrayBuffer()));
}

/** Plano B: Selic meta (série 432) descontada do IPCA de 12 meses (série 13522), do Banco Central. */
async function doBancoCentral(): Promise<JuroReal | null> {
  const ultimo = async (serie: number) => {
    const res = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados/ultimos/1?formato=json`, { headers: UA });
    if (!res.ok) throw new Error(`Banco Central ${serie}: HTTP ${res.status}`);
    const [p] = (await res.json()) as { data: string; valor: string }[];
    return { valor: Number.parseFloat(p?.valor) / 100, data: p?.data };
  };
  const [selic, ipca] = await Promise.all([ultimo(432), ultimo(13522)]);
  if (!Number.isFinite(selic.valor) || !Number.isFinite(ipca.valor)) return null;
  return { taxa: (1 + selic.valor) / (1 + ipca.valor) - 1, fonte: "Selic descontada do IPCA de 12 meses", data: new Date(dataBr(selic.data)).toISOString().slice(0, 10) };
}

/** Juro real do momento (guardado por 7 dias). Sem nenhuma fonte, devolve null e o teto usa os mínimos fixos. */
export async function juroReal(): Promise<JuroReal | null> {
  const c = await lerCache<JuroReal>("juro_real");
  if (c && c.idadeDias < 7) return c.dados;
  for (const [nome, buscar] of [["Tesouro", doTesouro], ["Banco Central", doBancoCentral]] as const) {
    try {
      const j = await buscar();
      if (j && j.taxa > 0 && j.taxa < 0.2) {
        await salvarCache("juro_real", j);
        return j;
      }
    } catch (err) {
      console.warn(`  Juro real (${nome}): ${(err as Error).message}`);
    }
  }
  return c?.dados ?? null;
}

/** Dividend yield exigido para o preço teto, conforme o juro real. */
export type YieldExigido = { acao: number; fii: number; juroReal: JuroReal | null };

/**
 * Ações: DY exigido = juro real (o dividendo cresce com a inflação, como o IPCA+), entre 6% e 9%.
 * FIIs: juro real + 1,5 ponto (crescem menos que ações), entre 8% e 11%.
 * Sem juro real, ficam nos mínimos clássicos (6% e 8%).
 */
export function yieldExigido(j: JuroReal | null): YieldExigido {
  const entre = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  if (!j) return { acao: 0.06, fii: 0.08, juroReal: null };
  const r = (v: number) => Math.round(v * 1000) / 1000; // passo de 0,1 ponto, para o teto não oscilar à toa
  return { acao: r(entre(j.taxa, 0.06, 0.09)), fii: r(entre(j.taxa + 0.015, 0.08, 0.11)), juroReal: j };
}

/** Yield exigido usado na última análise (para mostrar nas telas). */
export async function yieldAtual(): Promise<YieldExigido> {
  try {
    const [c] = await query<{ valor: string }>("select valor from config where chave = 'yield_exigido'");
    if (c) return JSON.parse(c.valor) as YieldExigido;
  } catch {
    /* sem banco ou sem análise ainda */
  }
  return yieldExigido(null);
}
