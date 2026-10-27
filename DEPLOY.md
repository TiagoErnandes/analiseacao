# Deploy na VPS (mesma VPS do Fresh Tech)

Mesmo esquema do Fresh Tech: Docker Compose + Nginx + scripts que rodam do Windows (Git Bash).
O app sobe 3 containers separados do Fresh Tech:

| Container | O que faz |
|---|---|
| `analiseacao_postgres` | Banco próprio (não expõe porta para fora) |
| `analiseacao_web` | O site, em `127.0.0.1:3010` (o Nginx encaminha pra ele) |
| `analiseacao_agendador` | Roda a análise de segunda a sexta às 7h (Brasília) |

## 1. Subdomínio

No painel de DNS, crie um registro **A** `acoes` (ou o nome que quiser) apontando para `179.197.233.72`.

## 2. Primeira subida

**[LOCAL]** Na raiz do repo, envie o código (vai pedir a senha do `freshtech`):

```bash
bash deploy/deploy.sh
```

Na primeira vez ele vai parar avisando que falta o `.env.production`. Então:

**[VPS]**

```bash
ssh freshtech@179.197.233.72
cd ~/analiseacao
cp .env.production.example .env.production
nano .env.production
```

Preencha:
- `POSTGRES_PASSWORD` (gere com `openssl rand -hex 24`) e a **mesma senha** dentro do `DATABASE_URL`.
- `ANTHROPIC_API_KEY` — chave da API em https://console.anthropic.com.
- `APP_PASSWORD` — a senha para abrir o site.

Depois rode de novo no Windows:

```bash
bash deploy/deploy.sh
```

O banco já nasce com as tabelas, a sua carteira e a lista das 30 maiores do Ibovespa (`db/schema.sql`).

## 3. Nginx + HTTPS

**[VPS]**

```bash
sudo cp ~/analiseacao/deploy/nginx.conf /etc/nginx/sites-available/analiseacao
sudo nano /etc/nginx/sites-available/analiseacao      # trocar SEU_SUBDOMINIO_AQUI
sudo ln -s /etc/nginx/sites-available/analiseacao /etc/nginx/sites-enabled/analiseacao
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d SEU_SUBDOMINIO_AQUI
```

Não mexe no site do Fresh Tech: é outro arquivo e outro `server_name`.

## 4. Primeira análise (sem esperar as 7h)

**[LOCAL]**

```bash
bash deploy/analisar-agora.sh
```

Leva alguns minutos (a IA pesquisa notícias). Depois abra `https://SEU_SUBDOMINIO_AQUI`.

## Dia a dia

- Mudou o código: `bash deploy/deploy.sh`
- Rodar a análise na hora: `bash deploy/analisar-agora.sh`
- Ver o log do agendador: `ssh freshtech@179.197.233.72 "cd ~/analiseacao && docker compose -f docker-compose.prod.yml logs --tail 100 agendador"`
- Abrir o banco: `ssh freshtech@179.197.233.72 "cd ~/analiseacao && docker compose -f docker-compose.prod.yml exec postgres psql -U analiseacao"`
