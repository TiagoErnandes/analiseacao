// Fontes oficiais e gratuitas sobre as empresas:
// - B3: código CVM da empresa e proventos anunciados (dividendos e JCP, com data-com).
// - CVM (dados abertos): fatos relevantes, comunicados e avisos aos acionistas (IPE), e o lucro de cada ano nos balanços
//   anuais (DFP), para medir se a empresa lucra todo ano. Tudo fica no banco; só o que é novo é baixado.
import { unzipSync } from "fflate";
import { query } from "./db";
import { lerCache, salvarCache } from "./mercado";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; analiseacao/1.0)" };
const CVM = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC";

/** Lê CSV com ";" (aceita campos entre aspas). */
export function lerCsv(texto: string): Record<string, string>[] {
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') (campo += '"'), i++;
        else aspas = false;
      } else campo += ch;
    } else if (ch === '"' && campo === "") aspas = true;
    else if (ch === ";") linha.push(campo), (campo = "");
    else if (ch === "\n") {
      linha.push(campo.replace(/\r$/, ""));
      linhas.push(linha);
      (linha = []), (campo = "");
    } else campo += ch;
  }
  if (campo || linha.length) linhas.push([...linha, campo]);
  const [cab, ...resto] = linhas;
  if (!cab) return [];
  return resto.filter((l) => l.length > 1).map((l) => Object.fromEntries(cab.map((c, i) => [c.trim(), (l[i] ?? "").trim()])));
}

const dataBr = (s: string | undefined) => {
  const m = s?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

async function baixarZip(url: string, filtro: (nome: string) => boolean): Promise<Record<string, string>> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`${url.split("/").pop()}: HTTP ${res.status}`);
  const arquivos = unzipSync(new Uint8Array(await res.arrayBuffer()), { filter: (f) => filtro(f.name) });
  const latin1 = new TextDecoder("latin1");
  return Object.fromEntries(Object.entries(arquivos).map(([n, b]) => [n, latin1.decode(b)]));
}

// ---------------------------------------------------------------- B3: código CVM e proventos anunciados

export type ProventoAnunciado = { tipo: string; valor: number | null; dataCom: string | null; aprovadoEm: string | null; pagamento: string | null };
export type InfoB3 = { codigoCvm: number | null; proventos: ProventoAnunciado[] };

/** Classe da ação no ISIN (BRPETRACNPR6 -> ACNPR) para separar proventos de ON e PN. */
const CLASSE: Record<string, string[]> = { "3": ["ACNOR"], "4": ["ACNPR"], "5": ["ACNPA"], "6": ["ACNPB"], "7": ["ACNPC"], "8": ["ACNPD"] };

/** Dados da empresa na B3 (guardados por 1 dia). Só para ações. */
export async function infoB3(ticker: string): Promise<InfoB3 | null> {
  const emissor = ticker.slice(0, 4).toUpperCase();
  const chave = `b3:${emissor}`;
  const c = await lerCache<{ codigoCvm: number | null; proventos: (ProventoAnunciado & { isin: string })[] }>(chave);
  let dados = c?.idadeDias != null && c.idadeDias < 1 ? c.dados : null;
  if (!dados) {
    try {
      const param = Buffer.from(JSON.stringify({ issuingCompany: emissor, language: "pt-br" })).toString("base64");
      const res = await fetch(`https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetListedSupplementCompany/${param}`, {
        headers: UA,
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`B3 ${emissor}: HTTP ${res.status}`);
      const j = (await res.json()) as any;
      const e = Array.isArray(j) ? j[0] : j;
      if (!e) throw new Error(`B3 ${emissor}: sem dados`);
      const num = (v: unknown) => {
        const n = Number.parseFloat(String(v ?? "").replace(/\./g, "").replace(",", "."));
        return Number.isFinite(n) ? n : null;
      };
      dados = {
        codigoCvm: num(e.codeCVM),
        proventos: ((e.cashDividends ?? []) as any[]).map((p) => ({
          isin: String(p.isinCode ?? p.assetIssued ?? ""),
          tipo: String(p.label ?? "PROVENTO"),
          valor: num(p.rate),
          dataCom: dataBr(p.lastDatePrior),
          aprovadoEm: dataBr(p.approvedOn),
          pagamento: dataBr(p.paymentDate),
        })),
      };
      await salvarCache(chave, dados);
    } catch (err) {
      if (!c) {
        console.warn(`  ${(err as Error).message}`);
        return null;
      }
      dados = c.dados; // B3 fora do ar: usa o que já tinha
    }
  }
  const classe = CLASSE[ticker.slice(4)];
  return {
    codigoCvm: dados.codigoCvm,
    proventos: dados.proventos
      .filter((p) => !classe || !p.isin || classe.some((k) => p.isin.slice(6, 11) === k))
      .map(({ isin, ...p }) => (void isin, p)),
  };
}

/** Proventos aprovados nos últimos 60 dias ou com data-com ainda por vir. */
export function proventosRecentes(p: ProventoAnunciado[], hoje: string): ProventoAnunciado[] {
  const limite = new Date(Date.parse(hoje) - 60 * 86_400_000).toISOString().slice(0, 10);
  return p
    .filter((x) => (x.aprovadoEm ?? "") >= limite || (x.dataCom ?? "") >= hoje)
    .sort((a, b) => (b.aprovadoEm ?? "").localeCompare(a.aprovadoEm ?? ""))
    .slice(0, 4);
}

// ---------------------------------------------------------------- CVM: fatos relevantes e comunicados (IPE)

const CATEGORIAS = /fato relevante|comunicado ao mercado|aviso aos acionistas|dados econ/i;

/** Baixa os documentos do ano (uma vez por dia) e guarda os dos últimos 120 dias. */
/** `idadeMaxima`: em dias; o vigia de alertas usa um valor menor para ver fatos relevantes no mesmo dia. */
export async function atualizarDocumentosCvm(hoje = new Date(), idadeMaxima = 0.8): Promise<number> {
  const c = await lerCache<{ ok: true }>("cvm_ipe");
  if (c && c.idadeDias < idadeMaxima) return 0;
  const ano = hoje.getFullYear();
  const anos = hoje.getMonth() < 4 ? [ano - 1, ano] : [ano]; // no começo do ano, o arquivo novo ainda tem pouco
  const limite = new Date(hoje.getTime() - 120 * 86_400_000).toISOString().slice(0, 10);
  let total = 0;
  for (const a of anos) {
    const arqs = await baixarZip(`${CVM}/IPE/DADOS/ipe_cia_aberta_${a}.zip`, (n) => n.endsWith(".csv"));
    for (const texto of Object.values(arqs)) {
      const docs = lerCsv(texto)
        .map((r): Record<string, string> => ({ ...r, Data_Entrega: dataBr(r.Data_Entrega) ?? (r.Data_Entrega ?? "").slice(0, 10) }))
        .filter((r) => CATEGORIAS.test(r.Categoria ?? "") && r.Data_Entrega >= limite && r.Protocolo_Entrega);
      // Inserção em blocos (bem mais rápido que linha a linha)
      for (let i = 0; i < docs.length; i += 500) {
        const bloco = docs.slice(i, i + 500);
        await query(
          `insert into cvm_documentos (protocolo, cd_cvm, data, categoria, tipo, assunto, link)
           select * from unnest($1::text[], $2::int[], $3::date[], $4::text[], $5::text[], $6::text[], $7::text[])
           on conflict (protocolo) do nothing`,
          [
            bloco.map((r) => r.Protocolo_Entrega),
            bloco.map((r) => Number.parseInt(r.Codigo_CVM, 10) || 0),
            bloco.map((r) => r.Data_Entrega),
            bloco.map((r) => r.Categoria),
            bloco.map((r) => r.Tipo || null),
            bloco.map((r) => (r.Assunto || "").slice(0, 400) || null),
            bloco.map((r) => r.Link_Download || null),
          ],
        );
      }
      total += docs.length;
    }
  }
  await query("delete from cvm_documentos where data < now() - interval '400 days'");
  await salvarCache("cvm_ipe", { ok: true });
  return total;
}

export type Documento = { data: string; categoria: string; tipo: string | null; assunto: string | null; link: string | null };

/** Documentos dos últimos `dias` por código CVM (os mais novos primeiro, até 5 por empresa). */
export async function documentosRecentes(codigos: number[], dias = 45): Promise<Map<number, Documento[]>> {
  const mapa = new Map<number, Documento[]>();
  if (!codigos.length) return mapa;
  const linhas = await query<Documento & { cd_cvm: number }>(
    `select cd_cvm, data::text, categoria, tipo, assunto, link from cvm_documentos
      where cd_cvm = any($1::int[]) and data >= current_date - $2::int order by data desc`,
    [codigos, dias],
  );
  for (const l of linhas) {
    const lista = mapa.get(l.cd_cvm) ?? [];
    if (lista.length < 5) lista.push({ data: l.data, categoria: l.categoria, tipo: l.tipo, assunto: l.assunto, link: l.link });
    mapa.set(l.cd_cvm, lista);
  }
  return mapa;
}

// ---------------------------------------------------------------- CVM: lucro de cada ano (DFP)

/** Lucro do exercício de cada empresa num arquivo DRE da DFP (última versão, em reais). */
export function lucrosDaDre(linhas: Record<string, string>[], ano: number): Map<number, number> {
  type Melhor = { versao: number; conta: string; valor: number };
  const melhor = new Map<number, Melhor>();
  for (const r of linhas) {
    if (!/^[ÚU]LTIMO$/i.test(r.ORDEM_EXERC ?? "")) continue;
    if (!(r.DT_FIM_EXERC ?? "").startsWith(String(ano))) continue;
    const conta = r.CD_CONTA ?? "";
    // Conta de 2º nível "Lucro/Prejuízo (Consolidado) do Período/Exercício" (3.11 na maioria; o número muda em bancos e seguradoras)
    if (!/^3\.\d{2}$/.test(conta)) continue;
    const ds = r.DS_CONTA ?? "";
    if (!/lucro|preju/i.test(ds) || !/per[ií]odo|exerc[ií]cio/i.test(ds) || /antes|operac/i.test(ds)) continue;
    const cd = Number.parseInt(r.CD_CVM, 10);
    const valor = Number.parseFloat(r.VL_CONTA) * (/mil/i.test(r.ESCALA_MOEDA ?? "") ? 1000 : 1);
    const versao = Number.parseInt(r.VERSAO, 10) || 0;
    if (!cd || !Number.isFinite(valor)) continue;
    const m = melhor.get(cd);
    if (!m || versao > m.versao || (versao === m.versao && conta > m.conta)) melhor.set(cd, { versao, conta, valor });
  }
  return new Map([...melhor].map(([cd, m]) => [cd, m.valor]));
}

/**
 * Garante o lucro dos últimos 10 anos no banco. Cada ano é baixado uma vez (≈ 13 MB); os 2 anos mais recentes
 * são baixados de novo a cada 30 dias (empresas reapresentam balanços).
 */
export async function atualizarLucrosCvm(hoje = new Date()): Promise<string[]> {
  const feitos: string[] = [];
  const atual = hoje.getFullYear();
  for (let ano = atual - 10; ano < atual; ano++) {
    const marca = await lerCache<{ empresas: number }>(`dfp:${ano}`);
    const recente = ano >= atual - 2;
    if (marca && (!recente || marca.idadeDias < 30)) continue;
    try {
      const arqs = await baixarZip(`${CVM}/DFP/DADOS/dfp_cia_aberta_${ano}.zip`, (n) => /DRE_(con|ind)_/i.test(n));
      const con = Object.entries(arqs).find(([n]) => /DRE_con_/i.test(n))?.[1];
      const ind = Object.entries(arqs).find(([n]) => /DRE_ind_/i.test(n))?.[1];
      // Consolidado quando existe; senão o individual
      const lucros = new Map([...(ind ? lucrosDaDre(lerCsv(ind), ano) : []), ...(con ? lucrosDaDre(lerCsv(con), ano) : [])]);
      const cds = [...lucros.keys()];
      await query(
        `insert into lucros_anuais (cd_cvm, ano, lucro) select c, $3::int, l from unnest($1::int[], $2::numeric[]) as t(c, l)
         on conflict (cd_cvm, ano) do update set lucro = excluded.lucro`,
        [cds, cds.map((c) => lucros.get(c)), ano],
      );
      await salvarCache(`dfp:${ano}`, { empresas: cds.length });
      feitos.push(`${ano} (${cds.length} empresas)`);
    } catch (err) {
      console.warn(`  Balanços CVM ${ano}: ${(err as Error).message}`);
    }
  }
  return feitos;
}

export type HistoricoLucro = { anos: number; anosComLucro: number; crescimentoAnual: number | null; lucros: { ano: number; lucro: number }[] };

/** Lucro dos últimos 10 anos por código CVM. */
export async function historicoLucros(codigos: number[], hoje = new Date()): Promise<Map<number, HistoricoLucro>> {
  const mapa = new Map<number, HistoricoLucro>();
  if (!codigos.length) return mapa;
  const linhas = await query<{ cd_cvm: number; ano: number; lucro: number }>(
    "select cd_cvm, ano, lucro from lucros_anuais where cd_cvm = any($1::int[]) and ano >= $2 order by ano",
    [codigos, hoje.getFullYear() - 10],
  );
  const porEmpresa = new Map<number, { ano: number; lucro: number }[]>();
  for (const l of linhas) porEmpresa.set(l.cd_cvm, [...(porEmpresa.get(l.cd_cvm) ?? []), { ano: l.ano, lucro: l.lucro }]);
  for (const [cd, lucros] of porEmpresa) mapa.set(cd, resumirLucros(lucros));
  return mapa;
}

/** Quantos anos com lucro e o crescimento anual (média dos 3 primeiros contra a dos 3 últimos anos). */
export function resumirLucros(lucros: { ano: number; lucro: number }[]): HistoricoLucro {
  const ord = [...lucros].sort((a, b) => a.ano - b.ano);
  const anosComLucro = ord.filter((l) => l.lucro > 0).length;
  let crescimentoAnual: number | null = null;
  if (ord.length >= 6) {
    const media = (v: { lucro: number }[]) => v.reduce((s, l) => s + l.lucro, 0) / v.length;
    const ini = media(ord.slice(0, 3));
    const fim = media(ord.slice(-3));
    const anos = ord[ord.length - 2].ano - ord[1].ano; // distância entre os centros das janelas
    if (ini > 0 && fim > 0 && anos > 0) crescimentoAnual = (fim / ini) ** (1 / anos) - 1;
  }
  return { anos: ord.length, anosComLucro, crescimentoAnual, lucros: ord };
}
