// Fica rodando no container "agendador" e dispara a análise de segunda a sexta às 7h (Brasília).
import cron from "node-cron";
import { rodarAnalise } from "../lib/analise";
import { vigiarCarteira } from "../lib/alertas";
import { atualizarPrecosDoDia } from "../lib/precosAoVivo";

const HORARIO = process.env.ANALISE_CRON ?? "0 7 * * 1-5";
// Vigia de alertas de venda: a cada 30 minutos, das 7h às 22h, todos os dias (notícia sai também no fim de semana)
const VIGIA = process.env.VIGIA_CRON ?? "*/30 7-22 * * *";

async function rodar() {
  const inicio = Date.now();
  const r = await rodarAnalise("agendador").catch((err) => ({ motivo: String(err) }));
  if ("motivo" in r) return console.warn(`Análise não iniciada: ${r.motivo}`);
  await r.termino;
  console.log(`Análise terminou em ${Math.round((Date.now() - inicio) / 1000)}s`);
}

cron.schedule(HORARIO, rodar, { timezone: "America/Sao_Paulo" });
let vigiando = false;
cron.schedule(
  VIGIA,
  async () => {
    if (vigiando) return; // a anterior ainda não terminou
    vigiando = true;
    await vigiarCarteira().catch((err) => console.warn(`Vigia falhou: ${(err as Error).message}`));
    vigiando = false;
  },
  { timezone: "America/Sao_Paulo" },
);
console.log(`Vigia de alertas ativo: "${VIGIA}"`);

// Preços do site: a cada 5 minutos no horário do pregão, um pedido em lote ao Yahoo para todos os ativos
// (só os valores; nota, teto e recomendação continuam os da análise da manhã)
const PRECOS = process.env.PRECOS_CRON ?? "*/5 10-18 * * 1-5";
let atualizandoPrecos = false;
cron.schedule(
  PRECOS,
  async () => {
    if (atualizandoPrecos) return;
    atualizandoPrecos = true;
    await atualizarPrecosDoDia().catch((err) => console.warn(`Atualização de preços falhou: ${(err as Error).message}`));
    atualizandoPrecos = false;
  },
  { timezone: "America/Sao_Paulo" },
);
console.log(`Atualização de preços ativa: "${PRECOS}"`);
console.log(`Agendador ativo: "${HORARIO}" (America/Sao_Paulo)`);
