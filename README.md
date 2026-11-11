# <p align="center"><img src="assets/workerin-logo-dark.svg" alt="WorkerIN" width="280"></p>

<p align="center">
  <strong>Conectando os melhores freelancers e empresas através de matching inteligente, proximidade e tempo real.</strong><br>
  A plataforma comercial moderna, visual e segura para contratação ágil de serviços especializados.
</p>

<p align="center">
  <a href="https://workerin.netlify.app"><img src="https://img.shields.io/badge/Status-Online-success?style=for-the-badge&logo=netlify" alt="Status"></a>
  <a href="https://supabase.com"><img src="https://img.shields.io/badge/Database-Supabase-3ECF8E?style=for-the-badge&logo=supabase" alt="Supabase"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-24%2B-339933?style=for-the-badge&logo=node.js" alt="Node.js"></a>
  <a href="#-termos-de-uso--propriedade-comercial"><img src="https://img.shields.io/badge/Licen%C3%A7a-Propriet%C3%A1ria-red?style=for-the-badge" alt="Proprietária"></a>
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
Cadastre sua empresa e publique oportunidades com descrição, requisitos técnicos, orçamento previsto e modalidades de trabalho (Remoto, Híbrido ou Presencial). A demanda é distribuída no feed segmentado do WorkerIN, alcançando centenas de talentos qualificados em poucos minutos.

### 2. ⚡ Dê Match e Contrate
Navegue por cards detalhados com fotos, apresentações audiovisuais (vídeo/GIF), competências verificadas, tarifas horárias e distância geográfica. Com a curtida mútua (**Match**), uma sala de conversa instantânea é aberta. Conduza alinhamentos pelo chat em tempo real ou realize uma **Live Call integrada (WebRTC)** sem depender de ferramentas externas para fechar a contratação.

### 3. 🛡️ Pague com segurança
Integrado a gateways de pagamento protegidos (como Mercado Pago), o valor acordado para o projeto fica retido com segurança na plataforma. O repasse financeiro ao freelancer só é autorizado quando as entregas forem aprovadas pela empresa contratante.

---

## 🎯 Encontre freelancers talentosos para...

| 💻 Desenvolver o seu código | 🎨 Desenhar seu website & UI/UX | 🎬 Criar o seu vídeo |
| :---: | :---: | :---: |
| Engenharia de Software, Full Stack, Node.js, React, Mobile (Flutter/React Native), APIs e Microsserviços. | UI/UX Design, Design Systems, Protótipos interativos no Figma, Landing Pages e Redesign de Interfaces. | Edição profissional para YouTube e Reels, Motion Graphics, Vídeos institucionais e Pós-produção. |

| ✍️ Escrever o seu conteúdo | 🏷️ Desenhar o seu logotipo | 🚀 Melhorar o seu SEO |
| :---: | :---: | :---: |
| Copywriting persuasivo, Artigos para blogs técnicos, Conteúdo para redes sociais e Roteiros de vídeo. | Identidade visual completa, Naming, Manuais de marca, Vetores e Criação de Logos memoráveis. | Otimização para buscadores (SEO On/Off-page), Performance Web (Core Web Vitals) e Tráfego Orgânico. |

---

## ✨ Recursos Comerciais & Diferenciais da Plataforma

- **Matchmaking Ágil:** Conexão mútua entre empresas e prestadores de serviços, aumentando a taxa de conversão e fechamento de contratos.
- **Geolocalização & Filtros Dinâmicos:** Descoberta por proximidade física ou âmbito nacional, com filtros por valor hora, área de atuação e formato de trabalho.
- **Portfólio Audiovisual Interativo:** Suporte nativo a carrossel de fotos, demonstrações em vídeo/GIF e links diretos para trabalhos anteriores.
- **Comunicação em Tempo Real:** Mensageria instantânea via WebSocket e sinalização de chamadas de vídeo peer-to-peer (WebRTC) para entrevistas técnicas.
- **WorkerIN Pro (Modelo de Monetização SaaS):** Plano de assinatura recorrente para usuários e empresas que desbloqueia:
  - Visualização de quem visitou o perfil;
  - Acesso à lista de curtidas recebidas antes do match;
  - Envio de mensagens diretas prioritárias.

---

## 🚀 Como Executar o Ambiente

### Pré-requisitos
- **Node.js** 24 ou superior
- **NPM** instalado

### Instalação e Execução
```bash
# Instalação das dependências da API
npm --prefix services/api-node install

# Inicialização do servidor em modo de desenvolvimento
npm run dev
```

Abra no navegador em: **`http://localhost:4173`**

> **Arquitetura Híbrida de Dados:** A plataforma opera com persistência local para demonstrações e testes rápidos, e conecta-se automaticamente ao **Supabase** (PostgreSQL com RLS, Auth e Storage de Mídias) ao identificar as chaves no arquivo `.env`.

---

## 🏗️ Engenharia & Tecnologias

- **Frontend:** Single Page Application (SPA) construída com Vanilla ESModules, CSS Custom Properties (tema Dark/Light) e layout totalmente responsivo.
- **Backend Core:** Node.js 24 + Express com roteamento REST, validação de payload, WebSockets nativos e sinalização WebRTC.
- **Persistência de Dados & Auth:** Supabase (PostgreSQL, Auth e Storage) com fallback para persistência local JSON em ambientes de demonstração.
- **Microsserviços de Apoio (Stack Docker Compose):**
  - **Spring Cloud Gateway:** Roteamento central e balanceamento de tráfego.
  - **Go:** Serviço de alta performance para mensageria e presença em tempo real.
  - **Java / Spring Boot:** Algoritmo ponderado de ranking de candidatos por competência e proximidade.
  - **Scala 3:** Pipeline de agregação de eventos e métricas de conversão.
  - **MinIO:** Armazenamento de arquivos compatível com S3.

---

## 🌐 Publicação & Infraestrutura

- **Frontend:** Hospedado no [Netlify](https://workerin.netlify.app) e compatível com [Vercel](https://vercel.com) através do build estático em `dist/`.
- **Backend:** Preparado para deploy no [Render](https://render.com) (`render.yaml`), Railway ou servidores dedicados/VPS.
- Guia detalhado de configuração de credenciais em [SUPABASE_SETUP.md](SUPABASE_SETUP.md).
- Especificação de rotas e arquitetura em [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 🔒 Termos de Uso & Propriedade Comercial

**TODOS OS DIREITOS RESERVADOS.**

Este software, incluindo seu código-fonte, arquitetura, design, marcas, elementos visuais e documentação associada, é um **produto comercial de propriedade intelectual exclusiva de seu autor**.

- ❌ **É proibida** a cópia, modificação, redistribuição, engenharia reversa ou sublicenciamento deste software sem autorização prévia e expressa por escrito do proprietário.
- ❌ **Não se trata de software de código aberto (Open Source)**: o acesso ao repositório não concede nenhuma licença implícita para comercialização, revenda ou uso por terceiros.
- 💼 **Uso Comercial & Licenciamento:** Para aquisição de licença de uso, contratação da plataforma em modelo White-Label ou parcerias comerciais, entre em contato diretamente com o proprietário.

<br>

<p align="center">
  <strong>WorkerIN © 2026 — Plataforma Comercial Proprietária.</strong><br>
  Todos os direitos reservados.
</p>
