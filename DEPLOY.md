# Deploy na VPS (mesma VPS do Fresh Tech)

Mesmo esquema do Fresh Tech: Docker Compose + Nginx + scripts que rodam do Windows (Git Bash).
O app sobe 3 containers separados do Fresh Tech:

| Container | O que faz |
|---|---|
| `analiseacao_postgres` | Banco próprio (não expõe porta para fora) |
| `analiseacao_web` | O site, em `127.0.0.1:3010` (o Nginx encaminha pra ele) |
| `analiseacao_agendador` | Roda a análise de segunda a sexta às 7h (Brasília) |

## 1. Primeira vez: um comando só

**[LOCAL]** No Git Bash, na raiz do repo:

```bash
bash deploy/configurar.sh
```

Ele pergunta só duas coisas:
- **Chave da API da Anthropic**: crie em https://console.anthropic.com/settings/keys (precisa ter crédito em Billing).
- **Senha do site**: invente uma. É a que o navegador vai pedir para abrir o app.

O resto é automático: gera a senha do banco, cria o `.env.production`, configura o Nginx com o endereço
grátis `acoes.179.197.233.72.sslip.io`, tenta o HTTPS e sobe os containers. A VPS vai pedir a senha do
`freshtech` algumas vezes e a do `sudo` uma vez.

Quando tiver um domínio próprio, troque o `server_name` em `/etc/nginx/sites-available/analiseacao` e rode o certbot de novo.

## 2. Primeira análise (sem esperar as 7h)

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
