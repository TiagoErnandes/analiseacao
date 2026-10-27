export const brl = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** R$ 12,3 mil / R$ 1,2 mi, para números grandes em cartões. */
export const brlCompacto = (v: number | null | undefined) =>
  v == null
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", notation: Math.abs(v) >= 100_000 ? "compact" : "standard" });

export const pct = (v: number | null | undefined, casas = 1) =>
  v == null ? "—" : `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

/** Percentual com sinal: +3,2% / -1,0% */
export const pctSinal = (v: number | null | undefined, casas = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${pct(v, casas)}`);

export const num = (v: number | null | undefined, casas = 2) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

export const dataBr = (iso: string) => {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
};

export const dataCurta = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};
