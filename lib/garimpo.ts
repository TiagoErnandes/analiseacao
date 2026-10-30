// Garimpo: procura boas ações e FIIs fora da sua lista, na tabela pública do Fundamentus (uma página com todas as
// empresas da bolsa). Os aprovados entram na análise do dia como qualquer outro ativo (preço teto, qualidade, IA).
import { lerCache, numeroBr, salvarCache } from "./mercado";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; analiseacao/1.0)" };

/** Quantos ativos o garimpo acrescenta por dia. */
export const MAX_ACOES = 20; // depois, só fica quem passa no padrão previdência (porte, setor, 10 anos de lucro e dividendo)
export const MAX_FIIS = 2; // foco em ações: poucos FIIs de fora

type Linha = Record<string, string>;

/** Lê a tabela de resultado do Fundamentus (cabeçalho em <th>, valores em <td>). */
export function lerTabela(html: string): Linha[] {
  const tabela = html.match(/<table[^>]*id="resultado"[\s\S]*?<\/table>/i)?.[0] ?? html;
  const texto = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  const cab = [...(tabela.match(/<thead[\s\S]*?<\/thead>/i)?.[0] ?? "").matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => texto(m[1]));
  const corpo = tabela.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] ?? "";
  return [...corpo.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((tr) => [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => texto(m[1])))
    .filter((c) => c.length >= cab.length && c[0])
    .map((c) => Object.fromEntries(cab.map((h, i) => [h, c[i]])));
}

const col = (l: Linha, ...nomes: RegExp[]) => {
  const k = Object.keys(l).find((h) => nomes.some((n) => n.test(h)));
  return k ? numeroBr(l[k]) : null;
};

export type Achado = { ticker: string; motivo: string };

/** Ações: lucrativas, baratas, que pagam bem, com dívida controlada e liquidez para comprar e vender. */
export function filtrarAcoes(linhas: Linha[], ja: Set<string>, max = MAX_ACOES): Achado[] {
  const candidatos = linhas
    .map((l) => ({
      ticker: (l.Papel ?? "").toUpperCase(),
      pl: col(l, /^P\/L$/i),
      pvp: col(l, /^P\/VP$/i),
      dy: col(l, /div\.?\s*yield/i),
      roe: col(l, /^ROE$/i),
      liq: col(l, /liq\.?\s*2\s*meses/i),
      divida: col(l, /d[ií]v\.?\s*brut/i),
      patrimonio: col(l, /patrim/i),
    }))
    .filter(
      (c) =>
        /^[A-Z]{4}\d{1,2}$/.test(c.ticker) &&
        c.liq != null && c.liq >= 5_000_000 &&
        c.pl != null && c.pl >= 2 && c.pl <= 15 &&
        c.roe != null && c.roe >= 0.12 &&
        c.dy != null && c.dy >= 0.05 && c.dy <= 0.2 && // acima de 20% costuma ser dividendo extraordinário
        c.pvp != null && c.pvp > 0 &&
        (c.divida == null || c.divida <= 1.5) &&
        c.patrimonio != null && c.patrimonio >= 2_000_000_000, // empresa de porte (patrimônio de R$ 2 bi ou mais)
    )
    .map((c) => ({
      ...c,
      // Barato e bom: dividendo, rentabilidade e P/L baixo
      nota: (Math.min(c.dy!, 0.15) / 0.15) * 0.4 + (Math.min(c.roe!, 0.3) / 0.3) * 0.3 + (1 - c.pl! / 15) * 0.3,
    }));
  // Uma classe por empresa (a mais líquida), e só quem ainda não está na análise
  const porEmpresa = new Map<string, (typeof candidatos)[number]>();
  for (const c of candidatos) {
    const e = c.ticker.slice(0, 4);
    if ([...ja].some((t) => t.startsWith(e))) continue;
    if (!porEmpresa.has(e) || (porEmpresa.get(e)!.liq ?? 0) < (c.liq ?? 0)) porEmpresa.set(e, c);
  }
  const pct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")}%`;
  return [...porEmpresa.values()]
    .sort((a, b) => b.nota - a.nota)
    .slice(0, max)
    .map((c) => ({ ticker: c.ticker, motivo: `P/L ${c.pl!.toFixed(1)}, ROE ${pct(c.roe!)}, DY ${pct(c.dy!)}` }));
}

/** FIIs: abaixo do patrimônio, rendimento bom (sem exagero), vacância baixa, grandes e líquidos. */
export function filtrarFiis(linhas: Linha[], ja: Set<string>, max = MAX_FIIS): Achado[] {
  const pct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")}%`;
  return linhas
    .map((l) => ({
      ticker: (l.Papel ?? "").toUpperCase(),
      pvp: col(l, /^P\/VP$/i),
      dy: col(l, /dividend\s*yield/i),
      liq: col(l, /^liquidez/i),
      vacancia: col(l, /vac[aâ]ncia/i),
      valor: col(l, /valor de mercado/i),
      segmento: Object.entries(l).find(([h]) => /segmento/i.test(h))?.[1] ?? "",
    }))
    .filter(
      (c) =>
        /^[A-Z]{4}11$/.test(c.ticker) && !ja.has(c.ticker) &&
        c.liq != null && c.liq >= 1_000_000 &&
        c.valor != null && c.valor >= 1_000_000_000 &&
        // Previdência: só tijolo (imóveis com aluguel). Papel (CRI) e híbridos dependem de crédito e juros
        /log[íi]st|shopping|lajes|escrit|corporat|renda urbana|varejo|hospital|educa/i.test(c.segmento) &&
        c.pvp != null && c.pvp >= 0.75 && c.pvp <= 1.05 &&
        c.dy != null && c.dy >= 0.08 && c.dy <= 0.16 &&
        (c.vacancia == null || c.vacancia <= 0.1),
    )
    .sort((a, b) => b.dy! / b.pvp! - a.dy! / a.pvp!)
    .slice(0, max)
    .map((c) => ({ ticker: c.ticker, motivo: `P/VP ${c.pvp!.toFixed(2)}, DY ${pct(c.dy!)}` }));
}

async function pagina(url: string): Promise<string> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Fundamentus garimpo: HTTP ${res.status}`);
  return new TextDecoder("latin1").decode(await res.arrayBuffer());
}

/** Ativos achados hoje (guardados por 1 dia). `ja`: tickers que já estão na análise. */
export async function garimpar(ja: Set<string>): Promise<Achado[]> {
  const c = await lerCache<{ acoes: Linha[]; fiis: Linha[] }>("garimpo");
  let dados = c && c.idadeDias < 1 ? c.dados : null;
  if (!dados) {
    try {
      const [acoes, fiis] = await Promise.all([
        pagina("https://www.fundamentus.com.br/resultado.php").then(lerTabela),
        pagina("https://www.fundamentus.com.br/fii_resultado.php").then(lerTabela),
      ]);
      if (!acoes.length && !fiis.length) throw new Error("tabela vazia");
      dados = { acoes, fiis };
      await salvarCache("garimpo", dados);
    } catch (err) {
      if (!c) throw err;
      dados = c.dados;
    }
  }
  return [...filtrarAcoes(dados.acoes, ja), ...filtrarFiis(dados.fiis, ja)];
}
