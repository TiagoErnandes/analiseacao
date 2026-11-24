// Sem imports: usado também na tabela do ranking (no navegador).

/** Filtro "Boas empresas" do ranking: o mínimo para valer a pena olhar a ação. */
export const BOA_EMPRESA = {
  roeMinimo: 0.1, // 10% de ROE
  dividaMaxima: 2, // dívida bruta de até 2x o patrimônio (bancos não têm o dado e passam)
  liquidezMinima: 1_000_000, // R$ 1 milhão negociado por dia
  patrimonioMinimo: 1_000_000_000, // R$ 1 bilhão de patrimônio (porte)
  qualidadeMinima: 6, // nota de qualidade (0 a 10) das analisadas
  margemMaxima: 1.5, // mais de 150% até o teto costuma ser dado errado ou armadilha
  anosMinimos: 5, // anos de balanço na CVM para julgar a constância
  lucroMinimo: 0.7, // lucro em pelo menos 70% dos anos (7 de 10)
  dividendoMinimo: 0.5, // dividendo ou JCP em pelo menos metade dos anos (5 de 10)
} as const;

/** Constância nos últimos 10 anos (balanços da CVM). */
export type Constancia = { anos: number; anosComLucro: number; anosComDividendo: number; crescimentoLucro?: number | null };

/** Por que a constância não basta para o filtro (vazio: basta). */
export function motivosConstancia(c: Constancia | null | undefined): string[] {
  if (!c) return ["sem histórico de balanços na CVM"];
  const m: string[] = [];
  if (c.anos < BOA_EMPRESA.anosMinimos) m.push(`só ${c.anos} anos de balanço na CVM`);
  if (c.anosComLucro < Math.ceil(c.anos * BOA_EMPRESA.lucroMinimo)) m.push(`lucro em só ${c.anosComLucro} de ${c.anos} anos`);
  if (c.anosComDividendo < Math.ceil(c.anos * BOA_EMPRESA.dividendoMinimo)) m.push(`dividendo em só ${c.anosComDividendo} de ${c.anos} anos`);
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// Nota do ranking (0 a 100): uma nota só para toda a bolsa, com perfis de peso.

/** Os números de uma ação que entram na Nota, cada um já de 0 a 1 (null: não se aplica ou sem dado). */
export type FatoresNota = {
  desconto: number | null; // margem até o teto: 0 = 30% acima do teto, 1 = 40% ou mais abaixo
  confianca: number; // quanto o desconto vale: os anos com lucro (o teto de quem quase nunca lucra vem de um ano bom isolado)
  lucro: number | null; // anos com lucro nos últimos 10
  dividendo: number | null; // anos com dividendo ou JCP nos últimos 10
  roe: number | null; // 0 a 25% ou mais
  crescimento: number | null; // crescimento do lucro em 10 anos: -5% ao ano ou pior = 0, 10% ou mais = 1
  divida: number | null; // dívida bruta ÷ patrimônio: até 0,5x = 1, 2x ou mais = 0 (bancos: sem dado)
  analise: number | null; // só as analisadas: média da qualidade do balanço e da nota da IA
};

export type PerfilNota = "equilibrado" | "dividendos" | "valor" | "qualidade";
type Peso = Record<"desconto" | "lucro" | "dividendo" | "roe" | "crescimento" | "divida", number>;

export const PERFIS_NOTA: { id: PerfilNota; nome: string; descricao: string; pesos: Peso }[] = [
  { id: "equilibrado", nome: "Equilibrado", descricao: "Empresa boa a preço justo", pesos: { desconto: 40, lucro: 15, dividendo: 10, roe: 15, crescimento: 10, divida: 10 } },
  { id: "dividendos", nome: "Dividendos (Barsi)", descricao: "Renda constante: dividendo todo ano pesa mais", pesos: { desconto: 30, lucro: 15, dividendo: 30, roe: 10, crescimento: 5, divida: 10 } },
  { id: "valor", nome: "Valor (Graham)", descricao: "O desconto até o teto manda", pesos: { desconto: 55, lucro: 15, dividendo: 5, roe: 10, crescimento: 5, divida: 10 } },
  { id: "qualidade", nome: "Qualidade", descricao: "Rentabilidade, crescimento e balanço forte", pesos: { desconto: 25, lucro: 20, dividendo: 10, roe: 20, crescimento: 15, divida: 10 } },
];
export const PERFIL_PADRAO: PerfilNota = "equilibrado";
export const ehPerfilNota = (v: unknown): v is PerfilNota => PERFIS_NOTA.some((p) => p.id === v);

/** Parte da Nota das analisadas que vem da qualidade do balanço e da nota da IA (o resto, dos fatores acima). */
export const PESO_ANALISE = 0.15;

const entre = (v: number, min: number, max: number) => Math.max(0, Math.min(1, (v - min) / (max - min)));

type DadosNota = {
  tipo?: string | null;
  margem: number | null;
  roe: number | null;
  qualidade: number | null;
  nota_ia: number | null;
  divida?: number | null;
  constancia?: Constancia | null;
};

export function fatoresNota(a: DadosNota): FatoresNota {
  const acao = (a.tipo ?? "acao") === "acao";
  // A escala usa o desconto sobre o teto ((teto - preço) / teto) = margem / (1 + margem), limitado a -30%..40%:
  // mais de 40% abaixo do teto costuma ser armadilha (o mercado vê um problema), não bônus
  let desconto: number | null = null;
  if (a.margem != null) {
    const d = a.margem <= -1 ? -0.3 : a.margem / (1 + a.margem);
    desconto = (Math.max(-0.3, Math.min(0.4, d)) + 0.3) / 0.7;
  }
  const notas = [a.qualidade, a.nota_ia].filter((v): v is number => v != null).map((v) => Math.max(0, Math.min(10, v)) / 10);
  const analise = notas.length ? notas.reduce((s, v) => s + v, 0) / notas.length : null;
  if (!acao) {
    // FIIs e ETFs não têm balanço na CVM: só o desconto e a análise contam
    return { desconto, confianca: 1, lucro: null, dividendo: null, roe: null, crescimento: null, divida: null, analise };
  }
  const c = a.constancia;
  const base = c && c.anos ? Math.max(c.anos, BOA_EMPRESA.anosMinimos) : 0;
  const lucro = base ? c!.anosComLucro / base : 0; // sem histórico na CVM conta como zero (melhor errar para baixo)
  const dividendo = base ? c!.anosComDividendo / base : 0;
  return {
    desconto,
    confianca: base ? lucro : 0.5, // sem histórico, o desconto vale a metade
    lucro,
    dividendo,
    roe: a.roe == null ? 0 : entre(a.roe, 0, 0.25),
    crescimento: c?.crescimentoLucro == null ? null : entre(c.crescimentoLucro, -0.05, 0.1),
    divida: a.divida == null ? null : 1 - entre(a.divida, 0.5, 2),
    analise,
  };
}

export type ParteNota = { id: keyof Peso | "analise"; rotulo: string; peso: number; valor: number; pontos: number };

const ROTULO_PARTE: Record<ParteNota["id"], string> = {
  desconto: "Desconto até o teto",
  lucro: "Anos com lucro (10a)",
  dividendo: "Anos com dividendo (10a)",
  roe: "ROE",
  crescimento: "Crescimento do lucro (10a)",
  divida: "Dívida",
  analise: "Qualidade e nota da IA",
};

/**
 * Nota de 0 a 100 pelos pesos do perfil. Fator sem dado (dívida dos bancos, crescimento com pouco histórico, tudo menos o
 * desconto nos FIIs e ETFs) sai da conta e os outros pesos são reescalados. O desconto vale proporcional à confiança.
 * Nas analisadas, 15% da nota vem da qualidade do balanço e da nota da IA.
 */
export function notaDeFatores(f: FatoresNota, perfil: PerfilNota = PERFIL_PADRAO): { nota: number; partes: ParteNota[] } | null {
  if (f.desconto == null) return null;
  const pesos = (PERFIS_NOTA.find((p) => p.id === perfil) ?? PERFIS_NOTA[0]).pesos;
  const valores: Record<keyof Peso, number | null> = {
    desconto: f.desconto * f.confianca,
    lucro: f.lucro,
    dividendo: f.dividendo,
    roe: f.roe,
    crescimento: f.crescimento,
    divida: f.divida,
  };
  const ids = (Object.keys(pesos) as (keyof Peso)[]).filter((k) => valores[k] != null);
  const total = ids.reduce((s, k) => s + pesos[k], 0);
  const fatorBase = f.analise != null ? 1 - PESO_ANALISE : 1;
  const partes: ParteNota[] = ids.map((k) => {
    const peso = (pesos[k] / total) * fatorBase * 100;
    return { id: k, rotulo: ROTULO_PARTE[k], peso, valor: valores[k]!, pontos: peso * valores[k]! };
  });
  if (f.analise != null) partes.push({ id: "analise", rotulo: ROTULO_PARTE.analise, peso: PESO_ANALISE * 100, valor: f.analise, pontos: PESO_ANALISE * 100 * f.analise });
  return { nota: Math.round(partes.reduce((s, p) => s + p.pontos, 0)), partes };
}

/** Atalho: a Nota de uma linha do ranking pelo perfil. */
export function notaRanking(a: DadosNota, perfil: PerfilNota = PERFIL_PADRAO): number | null {
  return notaDeFatores(fatoresNota(a), perfil)?.nota ?? null;
}

/** Por que a linha sai do filtro "Só boas empresas" (null: fica). Teto e margem dependem do método escolhido. */
export function motivoForaDasBoas(a: { fora_do_filtro?: string | null; preco_teto: number | null; margem: number | null }): string | null {
  return (
    a.fora_do_filtro ??
    (a.preco_teto == null ? "sem preço teto por este método" : (a.margem ?? 0) > BOA_EMPRESA.margemMaxima ? "margem acima de 150% (dado suspeito ou armadilha)" : null)
  );
}
