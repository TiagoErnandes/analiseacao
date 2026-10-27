// Leitor mínimo de planilhas .xlsx (só valores, sem fórmulas nem estilos). Suficiente para os arquivos da B3.
import { strFromU8, unzipSync } from "fflate";

export type Celula = string | number | null;
export type Aba = { nome: string; linhas: Celula[][] };

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const desescapar = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? `&${e};`),
  );
/** Junta todos os <t> de um trecho (texto rico vem quebrado em vários). */
const textos = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => desescapar(m[1])).join("");

/** "B12" -> 1 (coluna, começando em 0) */
function coluna(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function lerXlsx(dados: Uint8Array): Aba[] {
  let arquivos: Record<string, Uint8Array>;
  try {
    arquivos = unzipSync(dados);
  } catch {
    throw new Error("O arquivo não é uma planilha .xlsx válida.");
  }
  const ler = (caminho: string) => (arquivos[caminho] ? strFromU8(arquivos[caminho]) : null);
  const workbook = ler("xl/workbook.xml");
  if (!workbook) throw new Error("O arquivo não é uma planilha .xlsx válida.");

  const compartilhadas = [...(ler("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textos(m[1]));
  const rels = new Map(
    [...(ler("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      /Id="([^"]+)"/.exec(m[0])?.[1],
      /Target="([^"]+)"/.exec(m[0])?.[1],
    ]),
  );

  return [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const nome = desescapar(/name="([^"]*)"/.exec(m[0])?.[1] ?? "");
    const alvo = rels.get(/r:id="([^"]+)"/.exec(m[0])?.[1]) ?? "";
    const caminho = alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, "")}`;
    const xml = ler(caminho) ?? "";
    const linhas: Celula[][] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const linha: Celula[] = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const corpo = c[2] ?? "";
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const tipo = /t="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
        let valor: Celula = null;
        if (tipo === "s") valor = v != null ? compartilhadas[Number(v)] ?? null : null;
        else if (tipo === "inlineStr") valor = textos(corpo);
        else if (tipo === "str" || tipo === "e") valor = v != null ? desescapar(v) : null;
        else if (tipo === "b") valor = v === "1" ? 1 : 0;
        else if (v != null) valor = Number(v);
        linha[ref ? coluna(ref) : linha.length] = valor;
      }
      linhas.push(Array.from(linha, (x) => x ?? null));
    }
    return { nome, linhas };
  });
}
