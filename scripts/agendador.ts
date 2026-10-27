// Fica rodando no container "agendador" e dispara a análise de segunda a sexta às 7h (Brasília).
import cron from "node-cron";
import { rodarAnalise } from "../lib/analise";

const HORARIO = process.env.ANALISE_CRON ?? "0 7 * * 1-5";

async function rodar() {
  const inicio = Date.now();
  const r = await rodarAnalise("agendador").catch((err) => ({ motivo: String(err) }));
  if ("motivo" in r) return console.warn(`Análise não iniciada: ${r.motivo}`);
  await r.termino;
  console.log(`Análise terminou em ${Math.round((Date.now() - inicio) / 1000)}s`);
}

cron.schedule(HORARIO, rodar, { timezone: "America/Sao_Paulo" });
console.log(`Agendador ativo: "${HORARIO}" (America/Sao_Paulo)`);
