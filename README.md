# WorkerIN

Plataforma de descoberta e conexão entre freelancers de tecnologia e empresas. Os cards incluem fotos, apresentação opcional em GIF/vídeo sem som, biografia, competências, tarifa, modelo de trabalho e distância. O modo local atende ao fluxo principal sem bancos externos; o stack distribuído pode ser iniciado com Docker quando disponível.

## Iniciar agora (modo local)

Requer Node.js 24 ou superior. Na pasta do projeto:

```powershell
npm --prefix services/api-node install
npm run dev
```

Abra <http://localhost:4173>. Esse modo funciona sem Docker e persiste contas, perfis, projetos, interesses, matches e mensagens em `data/local-demo.json`; uploads ficam em `data/uploads/`. Os arquivos locais são ignorados pelo Git. Crie uma conta como freelancer ou empresa pelo botão de perfil. Para criar um match real de demonstração, registre duas contas e dê like recíproco nos perfis uma da outra; a conversa autenticada abre após o match, sincroniza mensagens por WebSocket e carrega o histórico salvo. Transmissões ao vivo usam WebRTC entre navegadores, com sinalização autenticada pelo servidor local; câmera e microfone são solicitados somente quando a pessoa inicia a live. Em redes corporativas ou com NAT restritivo, a conexão pode exigir servidor TURN.

O servidor seleciona o modo Supabase quando `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY` estão preenchidas no `.env`; sem elas, inicia o modo local de demonstração. As migrações já estão em `supabase/migrations/`, e o banco WorkerIN dedicado foi criado no Supabase. Consulte [SUPABASE_SETUP.md](SUPABASE_SETUP.md) para chaves, autenticação e Mercado Pago.

O plano Free inclui curtidas e chat após match. O WorkerIN Pro custa R$ 7/mês e libera curtidas recebidas, visitantes e mensagens diretas. O checkout recorrente do Mercado Pago está implementado; adicione as credenciais do vendedor e o endereço HTTPS do site no ambiente do backend para ativar cobranças reais.

A busca usa as coordenadas autorizadas pelo navegador, com São Paulo como ponto inicial. O envio de fotos, GIF e vídeos está ativo no modo local. Geocodificação por endereço precisa de uma chave Google Maps/Mapbox no stack distribuído.

## Publicação no Netlify

O Netlify publica a interface estática. A API Node do WorkerIN também precisa de um backend público que aceite WebSockets para chat e sinalização de lives. O arquivo `render.yaml` prepara o backend como serviço free no Render. No deploy conectado ao Git do Netlify, o `netlify.toml` executa `npm run build:netlify`; configure `WORKERIN_API_BASE_URL` nas variáveis do build com a origem HTTPS da API. Para um deploy manual de arquivos, rode `npm run build:netlify` com essa variável definida e envie somente a pasta `dist/`. O arquivo `workerin-config.js` da pasta publicada aponta a interface para o backend.

Configure no ambiente do backend `ALLOWED_ORIGINS=https://workerin.netlify.app`, `APP_BASE_URL=https://workerin.netlify.app` e `AUTH_REDIRECT_URL=https://workerin.netlify.app`, além das chaves privadas do Supabase e Mercado Pago. Adicione também o endereço do site às Redirect URLs do Supabase Auth.

## Stack distribuído com Docker

Requisitos: Docker Desktop com Compose v2 habilitado e pelo menos 8 GB de memória disponíveis:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
docker compose up --build
```

Abra <http://localhost:4173>. O Gateway Spring fica em <http://localhost:8080>; o MinIO Console local, em <http://localhost:9001>. Cassandra e Elasticsearch podem demorar alguns minutos no primeiro boot. Consulte `docker compose logs -f api realtime gateway`. `docker compose down` mantém os volumes. `docker compose down -v` apaga os bancos e mídias locais.

Configure `MAPS_PROVIDER=google` ou `mapbox` e a chave correspondente no `.env` para geocodificação de endereço. Para deploy, troque os segredos, restrinja CORS, proteja mídia, habilite TLS e autenticação dos bancos.

## Desenvolvimento da API distribuída

Requer MongoDB, Redis, Elasticsearch e MinIO disponíveis:

```powershell
npm --prefix services/api-node install
npm --prefix services/api-node run dev
```

## Serviços incluídos

- **Nginx:** interface e proxy para `/api`, `/chat` e `/ws`.
- **Spring Cloud Gateway:** roteamento de entrada.
- **Node.js / Express:** cadastro, login, perfil de empresas e freelancers, projetos, filtros, interesses, matches, geolocalização e envio de mídia.
- **Go / WebSocket:** tickets curtos de chat, validação de acesso, presença Redis e histórico Cassandra.
- **Java / Spring Boot:** ranking interno por competências, distância e orçamento.
- **Scala 3:** eventos agregados de analytics.
- **MongoDB:** contas, perfis, projetos, interesses, matches e conversas.
- **Redis:** presença e distribuição em tempo real.
- **Cassandra:** histórico de mensagens.
- **Elasticsearch:** descoberta geográfica e filtros, com fallback para MongoDB.
- **MinIO:** armazenamento de fotos, GIFs e vídeos.

A arquitetura e os endpoints ficam em [ARCHITECTURE.md](ARCHITECTURE.md). IA fica fora do escopo. A transmissão WebRTC está implementada no modo local; o stack distribuído ainda não inclui gravação nem relé de mídia SFU.

Os logotipos vetoriais em Poppins ficam em `assets/workerin-logo-dark.svg` (versão para fundo escuro) e `assets/workerin-logo-light.svg` (versão para fundo claro). O monograma quadrado W+IN, usado no app e no favicon, fica em `assets/workerin-symbol.svg`.


