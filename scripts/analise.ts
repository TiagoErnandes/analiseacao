// Roda a análise uma vez, na hora: `npm run analise`.
import { rodarAnalise } from "../lib/analise";
import { pool } from "../lib/db";

(async () => {
  const r = await rodarAnalise("manual");
  if ("motivo" in r) {
    console.log(r.motivo);
  } else {
    await r.termino;
  }
  await pool().end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
