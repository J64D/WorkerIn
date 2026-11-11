# <p align="center"><img src="assets/workerin-logo-dark.svg" alt="WorkerIN" width="280"></p>

<p align="center">
  <strong>Conectando os melhores freelancers e empresas através de matching inteligente, proximidade e tempo real.</strong><br>
  A forma ágil, visual e segura de contratar profissionais e fechar novos projetos.
</p>

<p align="center">
  <a href="https://workerin.netlify.app"><img src="https://img.shields.io/badge/Status-Online-success?style=for-the-badge&logo=netlify" alt="Status"></a>
  <a href="https://supabase.com"><img src="https://img.shields.io/badge/Database-Supabase-3ECF8E?style=for-the-badge&logo=supabase" alt="Supabase"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-24%2B-339933?style=for-the-badge&logo=node.js" alt="Node.js"></a>
  <a href="#licen%C3%A7a"><img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License"></a>
</p>

---

## 💡 Como Funciona o WorkerIN?

Anuncie seus projetos facilmente, encontre os melhores profissionais por afinidade e localização, e contrate com total segurança e agilidade.

<br>

<div align="center">

```
  ┌─────────────────────────────┐       ┌─────────────────────────────┐       ┌─────────────────────────────┐
  │     1. Publique sua Vaga    │  ───▶ │   2. Conecte e Contrate     │  ───▶ │    3. Pague com Segurança   │
  │ Demanda visível no feed     │       │ Match, chat ao vivo e live  │       │ Liberação após a entrega    │
  └─────────────────────────────┘       └─────────────────────────────┘       └─────────────────────────────┘
```

</div>

<br>

### 1. 📢 Publique uma vaga ou projeto
Cadastre sua empresa e publique a oportunidade com os requisitos, faixa de valor e modalidade (Remoto, Híbrido ou Presencial). Sua vaga ganha destaque imediato para centenas de profissionais qualificados no WorkerIN, recebendo interesse de talentos compatíveis em poucos minutos.

### 2. ⚡ Dê Match e Contrate
Navegue pelos perfis dinâmicos de freelancers com fotos, apresentações em vídeo, portfólio comprovado, avaliações e geolocalização. Ao darem curtida mútua (**Match**), uma sala de conversa instantânea é aberta. Conduza alinhamentos pelo chat em tempo real ou realize uma **Live Call integrada (WebRTC)** sem precisar de apps externos para fechar a contratação com quem realmente tem fit.

### 3. 🛡️ Pague com segurança
Com o fluxo de pagamento protegido integrado ao WorkerIN (via Mercado Pago), o valor acordado para o projeto fica resguardado com garantia total na plataforma. O pagamento só é repassado ao freelancer quando os marcos acordados forem concluídos e aprovados pela sua empresa.

---

## 🎯 Encontre freelancers talentosos para...

Explore especialistas prontos para entregar valor imediato ao seu negócio:

| 💻 Desenvolver o seu código | 🎨 Desenhar seu website & UI/UX | 🎬 Criar o seu vídeo |
| :---: | :---: | :---: |
| Engenharia de Software, Full Stack, Node.js, React, Mobile (Flutter/React Native), APIs e Microsserviços. | UI/UX Design, Design Systems, Protótipos interativos no Figma, Landing Pages e Redesign de Interfaces. | Edição profissional para YouTube e Reels, Motion Graphics, Vídeos institucionais e Pós-produção. |

| ✍️ Escrever o seu conteúdo | 🏷️ Desenhar o seu logotipo | 🚀 Melhorar o seu SEO |
| :---: | :---: | :---: |
| Copywriting persuasivo, Artigos para blogs técnicos, Conteúdo para redes sociais e Roteiros de vídeo. | Identidade visual completa, Naming, Manuais de marca, Vetores e Criação de Logos memoráveis. | Otimização para buscadores (SEO On/Off-page), Performance Web (Core Web Vitals) e Tráfego Orgânico. |

---

## ✨ Diferenciais do WorkerIN

- **Matchmaking Ágil:** Conexão mútua e dinâmica entre contratantes e profissionais, eliminando burocracias e trocas de e-mails infinitas.
- **Busca por Raio Geográfico & Filtros:** Encontre talentos próximos de você ou em qualquer lugar do Brasil com filtros por tarifa horária, competências e modalidade.
- **Portfólios com Apresentação Visual:** Suporte a carrossel de fotos, links de trabalhos anteriores e **apresentações em vídeo ou GIF** direto no card do perfil.
- **Chat em Tempo Real & Live Calls:** Mensageria via WebSocket e chamadas de vídeo peer-to-peer (WebRTC) para tirar dúvidas e fechar contratos na hora.
- **WorkerIN Pro:** Plano premium (R$ 7/mês) para freelancers e empresas que desejam saber quem visualizou seu perfil, ver curtidas recebidas antes do match e enviar mensagens diretas prioritárias.

---

## 🚀 Como Executar Localmente

### Pré-requisitos
- **Node.js** 24 ou superior
- **NPM** instalado

### Passo a Passo

```bash
# 1. Clone o repositório
git clone https://github.com/J64D/WorkerIn.git
cd WorkerIn

# 2. Instale as dependências da API
npm --prefix services/api-node install

# 3. Inicie o ambiente de desenvolvimento
npm run dev
```

Abra seu navegador em: **`http://localhost:4173`**

> **Modo Híbrido Automático:** O WorkerIN inicia por padrão em modo local (persistindo contas e conversas em arquivo JSON para testes ágeis sem Docker). Ao configurar as chaves do **Supabase** no `.env`, a aplicação ativa instantaneamente o modo de nuvem com PostgreSQL gerenciado e Auth integrado.

---

## 🏗️ Arquitetura do Sistema

O projeto conta com uma arquitetura flexível que atende desde testes rápidos até operação em produção:

- **Frontend:** SPA veloz e moderna (Vanilla ESModules, HTML5 semântico, tema Dark/Light com tokens em CSS).
- **Backend Central:** Node.js 24 + Express com rotas de API REST, WebSockets nativos e WebRTC Signaling.
- **Persistência & Auth:** Supabase (PostgreSQL com RLS, Auth e Storage de Mídia) com suporte a fallback local.
- **Microsserviços Distribuídos (Docker Compose opcional):**
  - **Gateway:** Spring Cloud Gateway (Java).
  - **Mensageria Realtime:** Go WebSocket Server de baixa latência.
  - **Ranking de Talentos:** Serviço Spring Boot com scoring ponderado por competência e distância.
  - **Analytics:** Serviço Scala 3 para agregação de eventos de acesso e conversão.
  - **Armazenamento de Mídia:** MinIO S3-compatível.

---

## 🌐 Publicação & Deploy

- **Frontend:** Hospedado no [Netlify](https://workerin.netlify.app) através de deploy contínuo via GitHub.
- **Backend:** Preparado para deploy no [Render](https://render.com) (`render.yaml`), Railway ou VPS.
- **Configurações de Banco de Dados:** Consulte o guia [SUPABASE_SETUP.md](SUPABASE_SETUP.md) para detalhes das migrations e variáveis de produção.
- **Documentação de Endpoints:** Detalhes em [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 📄 Licença

Este projeto é open-source e está licenciado sob os termos da **MIT License**.

<br>

<p align="center">
  WorkerIN — Onde empresas e talentos se encontram e realizam. 🚀
</p>
