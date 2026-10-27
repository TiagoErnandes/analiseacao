// Roda a análise uma vez, na hora: `npm run analise`.
import { pool } from "../lib/db";
import { executarAnalise } from "./daily";

executarAnalise()
  .then(() => pool().end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
