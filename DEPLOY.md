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

Ele pergunta só uma coisa:
- **Chave da API da Anthropic**: crie em https://console.anthropic.com/settings/keys (precisa ter crédito em Billing).

O resto é automático: gera a senha do banco, cria o `.env.production`, configura o Nginx com o endereço
grátis `acoes.179.197.233.72.sslip.io`, tenta o HTTPS e sobe os containers. A VPS vai pedir a senha do
`freshtech` algumas vezes e a do `sudo` uma vez.

Quando tiver um domínio próprio, troque o `server_name` em `/etc/nginx/sites-available/analiseacao` e rode o certbot de novo.

## 2. Primeira análise (sem esperar as 7h)

Clique em **Rodar análise agora** no site (ou, no Git Bash, `bash deploy/analisar-agora.sh`).

Leva alguns minutos (a IA pesquisa notícias). Depois abra `https://SEU_SUBDOMINIO_AQUI`.

## Login com o Google (site para outras pessoas)

Com o login ligado, cada pessoa entra com a conta Google e vê só a própria carteira. A carteira que já existe fica com
o seu e-mail (`ADMIN_EMAIL`); quem entrar depois começa com a carteira vazia. O ranking, a análise e o placar são os mesmos
para todos. Só o dono roda a análise na hora, escolhe o modo da IA, mexe na lista da análise diária e recebe os alertas no celular.

1. Abra https://console.cloud.google.com, crie um projeto (ex.: "Preço Teto").
2. **APIs e serviços → Tela de consentimento OAuth** (ou "Google Auth Platform"): tipo **Externo**, nome do app, seu e-mail
   de suporte e de contato. Não precisa adicionar escopos (o login usa só nome, e-mail e foto).
3. Em **Público-alvo**, clique em **Publicar app** (em "Teste", só os e-mails da lista de testadores conseguem entrar).
   Como o app só pede nome, e-mail e foto, o Google não exige verificação.
4. **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web**:
   - Origens JavaScript autorizadas: `https://acoes.179.197.233.72.sslip.io`
   - URIs de redirecionamento autorizados: `https://acoes.179.197.233.72.sslip.io/api/auth/callback`
   - (para testar no seu computador, adicione também `http://localhost:3000/api/auth/callback`)
5. Copie o **ID do cliente** e a **Chave secreta** e rode, no Git Bash: `bash deploy/login-google.sh`
   (ele pergunta o ID, a chave e o seu e-mail, grava no `.env.production` e reinicia o site).
6. Abra o site e entre com o seu e-mail primeiro: a carteira atual, as compras, o histórico do patrimônio e a estratégia passam para a sua conta.

Para desligar o login, apague `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` do `.env.production` e reinicie: o site volta a ter
uma carteira só (a do dono). Se o Google recusar o endereço sslip.io, use um domínio próprio (troque nos passos 4 e 5 e no Nginx).

## Alerta de preço-alvo no WhatsApp

O botão **🎯 Definir meu Preço-Alvo** (página de cada ativo) avisa quando a cotação chega no seu preço. O aviso aparece no
painel e, para o dono do site, chega no celular pelos mesmos canais dos alertas de venda: **WhatsApp**, Telegram e/ou ntfy.
Para o WhatsApp há dois caminhos grátis; basta um.

### Caminho 1: API oficial do WhatsApp (Meta), recomendado

Usa o número de teste que a Meta dá de graça (manda para até 5 números cadastrados). A mensagem chega de outro número,
então o celular toca a notificação.

1. Entre em https://developers.facebook.com com a sua conta do Facebook, clique em **Meus apps → Criar app** e escolha o
   caso de uso do **WhatsApp** (conectar com clientes pelo WhatsApp). A Meta cria um número de teste e uma conta do WhatsApp Business.
2. No app, abra **WhatsApp → Configuração da API**:
   - copie o **Identificador do número de telefone** (Phone number ID) → `WHATSAPP_META_PHONE_ID`;
   - em **Para**, adicione o seu número (+55 31 9...) e digite o código que chega no seu WhatsApp.
3. **Token permanente** (o da tela de configuração vale só 24 horas): em https://business.facebook.com/settings, **Usuários →
   Usuários do sistema → Adicionar** (função Administrador), depois **Atribuir ativos** (o app, controle total) e **Gerar token**
   com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`, validade "Nunca" → `WHATSAPP_META_TOKEN`.
4. **Modelo de mensagem** (a Meta só entrega mensagem que você não pediu se for um modelo aprovado): no WhatsApp Manager,
   **Modelos de mensagem → Criar modelo**, categoria **Utilidade**, nome `alerta_carteira`, idioma **Português (BR)**, corpo:
   ```
   Alerta da sua carteira: {{1}}. Confira no site antes de decidir.
   ```
   Exemplo do {{1}}: `PETR4 está no ponto de COMPRA · Cotação: R$ 30,00 · Seu preço-alvo: R$ 30,50`. A aprovação costuma levar minutos.
5. No `.env.production`:
   ```
   WHATSAPP_NUMERO=+5531999999999
   WHATSAPP_META_PHONE_ID=123456789012345
   WHATSAPP_META_TOKEN=EAAG...
   WHATSAPP_META_MODELO=alerta_carteira
   ```

### Caminho 2: CallMeBot

Salve o número do robô que aparece em https://www.callmebot.com/blog/free-api-whatsapp-messages/ e mande para ele
`I allow callmebot to send me messages`. Ele responde com a apikey → `CALLMEBOT_WHATSAPP_APIKEY` (com `WHATSAPP_NUMERO`).
Às vezes o robô fica lotado e o site não mostra o número: tente de novo em alguns dias.

### Depois

Reinicie (`docker compose -f docker-compose.prod.yml up -d`) e clique em **Testar no celular** no painel ("Alertas da carteira").
Se der erro, o motivo aparece no log do agendador (`docker compose -f docker-compose.prod.yml logs agendador`).
O vigia confere os alvos a cada 10 minutos no pregão (`PRECO_ALVO_CRON`, padrão `*/10 10-18 * * 1-5`). Cada alvo avisa uma vez;
para avisar de novo, defina o alvo outra vez. Os alertas de venda da carteira também chegam pelo WhatsApp.

## Dia a dia

- Mudou o código: `bash deploy/deploy.sh`
- Rodar a análise na hora: botão **Rodar análise agora** no site (uma por vez, no máximo a cada 15 min)
- Ver o log do agendador: `ssh freshtech@179.197.233.72 "cd ~/analiseacao && docker compose -f docker-compose.prod.yml logs --tail 100 agendador"`
- Abrir o banco: `ssh freshtech@179.197.233.72 "cd ~/analiseacao && docker compose -f docker-compose.prod.yml exec postgres psql -U analiseacao"`

## Atualização automática (Windows)
Dê dois cliques em `atualizar.bat`, na pasta do projeto. A janela confere o GitHub a cada 5 minutos e, quando entra algo novo na `main`, faz o `git pull` e o deploy sozinha. Deixe a janela aberta; para parar, use Ctrl+C.
- Na primeira vez, ele cria uma chave SSH e pede a senha da VPS uma última vez. Depois disso, não pede mais.
- Para atualizar só uma vez, sem ficar vigiando, rode `atualizar.bat agora` no Prompt de Comando.
- Para abrir junto com o Windows, crie um atalho do `atualizar.bat` dentro da pasta `shell:startup` (Win+R → `shell:startup`).
