# Configurar Supabase e pagamentos do WorkerIN

O app está preparado para Supabase Auth, Postgres e Storage. A API Node acessa o Supabase no servidor; a chave secreta nunca vai para o navegador. Sem as credenciais do projeto, `npm run dev` continua abrindo o modo de demonstração local.

## 1. Supabase

1. Crie um projeto no Supabase e abra **SQL Editor → New query**.
2. As migrações `supabase/migrations/20261111151158_workerin_core.sql` e `supabase/migrations/20261111151332_index_workerin_foreign_keys.sql` já foram aplicadas ao projeto WorkerIN criado para o app. Em um ambiente novo, aplique-as em ordem.
3. Em **Project Settings → API**, copie a URL do projeto, a publishable key e a secret key. A secret key é só para o servidor.
4. Copie `.env.example` para `.env` e preencha estas variáveis:

```dotenv
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_MEDIA_BUCKET=workerin-media
AUTH_REDIRECT_URL=http://localhost:4173
JWT_SECRET=uma-chave-aleatoria-longa
SERVICE_TOKEN=outra-chave-aleatoria-longa
ALLOWED_ORIGINS=http://localhost:4173
```

   Projetos Supabase antigos podem usar `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` no lugar das chaves publishable/secret.
5. Em **Authentication → URL Configuration**, use `http://localhost:4173` como Site URL e inclua esse endereço nas Redirect URLs para confirmação de e-mail local. Em produção, substitua pelos endereços HTTPS do app e atualize `AUTH_REDIRECT_URL`.
6. Execute `npm run dev`. Com as três variáveis Supabase preenchidas, o app inicia no modo Supabase; sem elas, inicia no modo local de demonstração.

## 2. Mercado Pago Pro

O WorkerIN Pro cobra R$ 7 por mês via assinatura recorrente. O Mercado Pago não tem mensalidade fixa para começar a receber, mas desconta tarifas por pagamento aprovado; a tarifa efetiva depende do meio de pagamento e da conta. Não existe processamento de pagamentos reais sem essas tarifas.

1. Crie uma aplicação em **Suas integrações** no Mercado Pago e configure primeiro as credenciais de teste.
2. Adicione ao `.env`:

```dotenv
APP_BASE_URL=https://SEU-DOMINIO-PUBLICADO
MERCADOPAGO_ACCESS_TOKEN=APP_USR-...
MERCADOPAGO_WEBHOOK_SECRET=segredo-de-assinatura-do-webhook
```

3. Publique o app em HTTPS. O checkout recorrente requer `APP_BASE_URL` público e HTTPS para o retorno do cliente.
4. No painel da aplicação do Mercado Pago, cadastre o webhook `https://SEU-DOMINIO-PUBLICADO/api/payments/mercadopago/webhook`, habilite notificações de assinatura (`subscription_preapproval`) e copie o segredo de assinatura para `MERCADOPAGO_WEBHOOK_SECRET`.
5. Faça um pagamento de teste e confirme que o evento de assinatura chega ao endpoint. A conta só recebe os recursos Pro após a API verificar a assinatura do webhook e consultar o status diretamente no Mercado Pago.

As credenciais de produção devem substituir as de teste somente depois de validar o fluxo. Nunca coloque `SUPABASE_SECRET_KEY`, `SERVICE_TOKEN`, `MERCADOPAGO_ACCESS_TOKEN` ou o segredo do webhook em `app.js`, no HTML ou em um repositório público.

## Deploy no Netlify

O site informado para o WorkerIN é `https://workerin.netlify.app`. Ele hospeda a interface; para cadastro, chat e lives, publique também o servidor Node em um backend que aceite conexões WebSocket. O arquivo `render.yaml` prepara um serviço free no Render com a API, health check e variáveis necessárias; Render free pode suspender o serviço após inatividade, então é adequado para MVP e demonstração.

- Em um deploy conectado ao Git, o `netlify.toml` publica `dist/` e executa o build do frontend. Defina `WORKERIN_API_BASE_URL` nas variáveis de ambiente do build com a origem HTTPS do backend Node.
- Em um deploy manual, no PowerShell defina `$env:WORKERIN_API_BASE_URL="https://SUA-API"`, execute `npm run build:netlify` e envie a pasta `dist/` ao Netlify.
- No ambiente do backend, defina `ALLOWED_ORIGINS=https://workerin.netlify.app`, `APP_BASE_URL=https://workerin.netlify.app` e `AUTH_REDIRECT_URL=https://workerin.netlify.app`. Mantenha as chaves secretas somente nesse ambiente.
- Depois de publicar o backend, configure `WORKERIN_API_BASE_URL` nas variáveis de build do Netlify com a URL pública dele e faça novo deploy.
- Em **Authentication → URL Configuration**, cadastre `https://workerin.netlify.app` como Site URL e Redirect URL. Para testar localmente, mantenha também `http://localhost:4173` permitido.

O deploy estático sozinho não hospeda a API nem o servidor WebSocket. Até existir uma URL pública do backend e ela ser definida em `WORKERIN_API_BASE_URL`, cadastro/chat/lives na versão Netlify exibirão que falta configurar a API.

## Limites do modo gratuito

O plano gratuito do Supabase serve para desenvolvimento e MVP e tem limites de banco, arquivos e uso; projetos gratuitos podem pausar após inatividade. O Mercado Pago não cobra mensalidade fixa pelo checkout, mas cobra a tarifa de cada transação aprovada. Hospedagem pública HTTPS do app também pode ter custo, conforme o provedor escolhido.
