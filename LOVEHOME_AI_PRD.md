# LoveHome — PRD Técnico v2.0

> **Ponto de partida do projeto.** Este documento define arquitetura, decisões técnicas, estrutura de dados e roadmap de implementação do **LoveHome**, uma plataforma de atendimento e gestão imobiliária com IA Generativa.
>
> O projeto nasce como resposta ao **Tech Challenge FIAP — Fase 5** (Hackathon "Agente SDR Imobiliário com Inteligência Artificial"), mas o hackathon é tratado aqui como **Marco 1 de um produto maior**, não como o teto do escopo — a entrega da fase precisa acontecer dentro do prazo da turma, mas o desenho de dados e agentes já é feito pensando na plataforma completa (dois lados do mercado — quem procura e quem oferece imóvel —, ciclo de vida de contrato de locação e cobrança), para não jogar fora trabalho de arquitetura entre um marco e outro.
>
> O projeto **parte de uma fundação de mensageria multiagente já validada em produção** (WhatsApp multicanal, agentes com tool calling, RAG, observabilidade e segurança), e constrói por cima um domínio de dados novo: imóveis, cadastro formal por CPF, proprietários, contratos de locação, cobrança e aprovação de documentos.

**Produto:** LoveHome — Atendimento e gestão imobiliária via WhatsApp + web
**Stack:** Next.js (Vercel) · Supabase (PostgreSQL + pgvector + Auth) · Redis · OpenAI · Asaas (cobrança) · assinatura via gov.br ou manual (sem vendor pago)
**Responsável técnico:** Leonardo
**Revisado em:** Agosto 2026 — v2.0 (expansão de escopo: de "SDR que qualifica e agenda" para plataforma de dois lados com ciclo de vida de locação)


---

## Índice

1. [Contexto e Motivação](#1-contexto-e-motivação)
2. [O que é Reaproveitado, Adaptado, Novo e Removido](#2-o-que-é-reaproveitado-adaptado-novo-e-removido)
3. [Objetivos do Sistema](#3-objetivos-do-sistema)
4. [Cenários Esperados](#4-cenários-esperados)
5. [Persona e Contexto de Negócio](#5-persona-e-contexto-de-negócio)
6. [Identidade e Cadastro](#6-identidade-e-cadastro)
7. [Stack e Decisões de Arquitetura](#7-stack-e-decisões-de-arquitetura)
8. [Estrutura do Projeto](#8-estrutura-do-projeto)
9. [Autenticação e Papéis](#9-autenticação-e-papéis)
10. [Banco de Dados — Schema](#10-banco-de-dados--schema)
11. [Sistema RAG e Busca de Imóveis](#11-sistema-rag-e-busca-de-imóveis)
12. [Sistema Multiagente](#12-sistema-multiagente)
13. [Integração WhatsApp e Multi-canal](#13-integração-whatsapp-e-multi-canal)
14. [Integração de Pagamentos (Asaas)](#14-integração-de-pagamentos-asaas)
15. [Contratos e Assinatura Eletrônica](#15-contratos-e-assinatura-eletrônica)
16. [API Routes — Contrato](#16-api-routes--contrato)
17. [Painel Administrativo e Vitrine Pública](#17-painel-administrativo-e-vitrine-pública)
18. [Variáveis de Ambiente](#18-variáveis-de-ambiente)
19. [Mapeamento — Critérios de Avaliação do Hackathon](#19-mapeamento--critérios-de-avaliação-do-hackathon)
20. [Mapeamento — Entregáveis do Hackathon](#20-mapeamento--entregáveis-do-hackathon)
21. [Roadmap por Marcos](#21-roadmap-por-marcos)
22. [Riscos e Mitigações](#22-riscos-e-mitigações)
23. [Referências Internas](#23-referências-internas)

---

## 1. Contexto e Motivação

### 1.1 O desafio (Tech Challenge Fase 5)

A FIAP propõe construir uma **Prova de Conceito de um Agente SDR Imobiliário** usando IA Generativa: atender leads automaticamente, qualificá-los (compra, aluguel ou investimento), agendar visitas/reuniões, fazer follow-up automático e gerar resumos para corretores — avaliado em quatro eixos: **Arquitetura, Inteligência Artificial, Experiência do Usuário e Inovação** (ver `POSTECH - Hacka Agente_SDR_Imobiliario - Fase 5.pdf`). É atividade obrigatória valendo 90% da nota da fase — o prazo de entrega da turma continua sendo um fator real, mesmo que o produto final planejado vá além do enunciado.

### 1.2 Por que o escopo cresceu

A primeira versão deste PRD (v1.0) tratava o desafio como "qualificar lead → agendar visita → resumir para corretor" — suficiente pro enunciado, mas incompleto frente a como uma imobiliária de verdade opera: ela não atende só quem procura imóvel, atende também quem **tem** um imóvel para alugar, administra o **contrato** e a **cobrança** desse aluguel ao longo do tempo, e dá suporte ao inquilino durante toda a vigência. Ignorar esse segundo lado do mercado deixaria o PRD tecnicamente correto pro hackathon, mas descartável no dia seguinte.

Esta v2.0 desenha o domínio de dados e os agentes já pensando nesse ciclo completo — cadastro formal por CPF, papéis múltiplos (interessado / proprietário / inquilino ativo), listagem de imóvel por proprietário, reserva e coleta de documentos, geração de contrato, cobrança recorrente e autoatendimento do inquilino. O hackathon continua sendo a entrega imediata (Marco 1, seção 21), mas nenhuma decisão de schema ou de agente é tomada só pensando nele.

### 1.3 Fundação técnica

A fundação técnica é um sistema multiagente de atendimento via WhatsApp **já validado em produção**: multiagentes reais, RAG próprio, memória conversacional persistida, multicanal (Z-API + Meta + Widget), follow-up automático, observabilidade, segurança (RLS + criptografia) e deploy em cloud. O que ela não tem é o domínio imobiliário inteiro — imóveis, cadastro formal, proprietários, contratos, cobrança — que é o trabalho novo real deste projeto.

### 1.4 O que este documento é (e não é)

É o ponto de partida técnico do repositório `lovehome-ai`, que reaproveita os módulos de mensageria da fundação e constrói o restante. Não é uma cópia do código-fonte — é um PRD que aponta o que copiar, o que adaptar e o que criar, e que sequencia isso em marcos entregáveis (seção 21) em vez de tentar tudo de uma vez.

---

## 2. O que é Reaproveitado, Adaptado, Novo e Removido

| Camada | Status | Nota |
|---|---|---|
| Next.js + Vercel + Supabase + Redis + OpenAI | **Reaproveitado 100%** | Mesma stack, mesmas justificativas (seção 7) |
| Autenticação Supabase Auth + middleware | **Reaproveitado 100%** | Roles ganham `corretor` (seção 9) |
| Adapters de canal (`lib/channels/`: Z-API, Meta, Widget) | **Reaproveitado 100%** | Copiar como está |
| Pipeline unificado (dedup, identidade, takeover) | **Adaptado** | Ganha um novo passo determinístico: resolução de cadastro (seção 6.3) |
| Debounce de mensagens (Redis) | **Reaproveitado 100%** | Mesma lógica, mesmo TTL |
| Envio fracionado + mídia (Whisper/Vision) | **Reaproveitado 100%** | Vision também recebe fotos de imóvel enviadas pelo proprietário (seção 12.4) |
| Blacklist de contatos (`contact_blocklist`) | **Reaproveitado 100%** | Faltou entrar na v1.0 deste PRD, corrigido aqui |
| Orquestrador (roteamento) | **Adaptado** | Novo roster de agentes + sinais de `registration_status`/papéis (seção 12.2) |
| Agente SDR | **Reescrito** | Script de qualificação — Exemplo 1 |
| Agente Investidor | **Novo** | Script do Exemplo 2 |
| Agente Proprietário | **Novo** | Coleta imóvel a disponibilizar, sugere preço, aceita fotos — Exemplo 4 |
| Agente Agendamento | **Adaptado** | Consulta `broker_availability` interna em vez de Google Calendar por corretor |
| Agente Closer | **Reintroduzido, escopo cobre venda e locação** | Na v1.0 eu tinha removido por achar que "ninguém fecha compra de imóvel no WhatsApp" — verdade pra negociar preço, mas reserva/proposta + coleta de documentos é, sim, fechável em chat, tanto pra locação quanto pra venda (Exemplo 6) |
| Agente Suporte | **Ampliado** | Extrato de pagamento, status de contrato, prazos, solicitação de rescisão — Exemplo 5 |
| Agente Conteúdo | **Absorvido** | Vira tool (`search_properties`) dentro do SDR |
| Copiloto do Corretor | **Novo** | Assistente interno no painel — agenda, resumos, documentos pendentes (seção 12.8) |
| Gerador de resumo para corretor | **Novo** | Requisito explícito do hackathon |
| RAG (chunker/embedder/retriever) | **Reaproveitado (mecanismo)** | Conteúdo indexado é institucional + descrições de imóveis |
| Busca híbrida de imóveis + comparáveis de mercado | **Novo** | Seção 11 |
| Cadastro formal por CPF (`registrations`, `contact_roles`) | **Novo** | Seção 6 e 10 |
| Domínio de imóveis/visitas/corretores/resumos | **Novo** | Seção 10 |
| Domínio de negócios — venda e locação unificadas (`deals`), cobrança, documentos, aprovação | **Novo** | Seções 10, 14, 15 |
| Gateway de infoproduto (webhook, atribuição de vendas, recuperação de carrinho) | **Removido, mas o padrão volta** | O *mecanismo* (webhook + validação de assinatura + reconciliação por id externo) reaparece quase idêntico na integração Asaas (seção 14) — só troca o vendor |
| Tabelas de matrícula em curso | **Removido** | Específico do domínio anterior |
| Follow-up cron (janela de inatividade por canal) | **Reaproveitado 100%** | Mapeia direto para o Exemplo 3 |
| Human takeover / Kanban | **Reaproveitado 100%** | Corretor assume lead quente do mesmo jeito que a equipe assume aluna |
| Painel admin (shell, guard de auth, layout) | **Reaproveitado 100%** | Telas de domínio são adaptadas/novas (seção 17) |
| Vitrine pública de imóveis | **Novo** | Camada web sem autenticação, seção 17.3 |
| Segurança (RLS deny-all, AES-256-GCM, HMAC, timing-safe compare) | **Reaproveitado + estendido** | Novo padrão de hash determinístico pra CPF (seção 6.2) |
| Observabilidade (`message_traces`) | **Reaproveitado 100%** | — |

**Leitura prática:** a fundação de mensageria inteira continua vindo pronta — isso não muda entre v1.0 e v2.0. O que muda é o tamanho do domínio novo: em vez de 5 agentes e 6 tabelas novas, agora são 8 agentes de cliente + 1 copiloto interno, e um domínio de dados que cobre cadastro, propriedade, negócio (venda e locação), contrato e cobrança. É trabalho real de várias semanas, não de um sprint — por isso o roadmap por marcos (seção 21) importa mais nesta versão do que na anterior.

---

## 3. Objetivos do Sistema

### 3.1 Funcionais

**Lado de quem procura imóvel** (comprador/locatário/investidor):
- [ ] Atender leads automaticamente com conversa natural e humanizada
- [ ] Identificar intenção: compra, aluguel ou investimento
- [ ] Qualificar coletando faixa de preço, quartos, região, urgência
- [ ] Buscar imóveis compatíveis em base própria (simulada no Marco 1) e apresentá-los na conversa
- [ ] Encaminhar lead qualificado para agendamento de visita/reunião
- [ ] Reservar unidade de interesse e coletar documentação necessária
- [ ] Follow-up automático quando o lead para de responder, mantendo contexto

**Lado de quem oferece imóvel** (proprietário):
- [ ] Coletar dados do imóvel a disponibilizar (tipo, endereço, características)
- [ ] Sugerir faixa de preço com base em imóveis comparáveis da própria base
- [ ] Receber fotos do imóvel (via WhatsApp ou formulário)
- [ ] Encaminhar para aprovação interna antes de publicar na vitrine

**Autoatendimento de quem já é cliente** (inquilino ativo):
- [ ] Consultar extrato de pagamento e segunda via de boleto
- [ ] Consultar status/prazos do contrato de locação
- [ ] Solicitar rescisão, validada contra o prazo mínimo de aviso do contrato
- [ ] Escalar para corretor/suporte humano quando necessário

**Lado do corretor:**
- [ ] Cadastro de corretores, com imóveis e visitas escopados a cada um (RLS)
- [ ] Gestão da própria disponibilidade de agenda, consultada pelo agente Agendamento
- [ ] Copiloto de IA no painel: agenda do dia, resumo de lead, documentos pendentes, busca de imóvel

**Transversal:**
- [ ] Cadastro formal por CPF, com suporte a múltiplos papéis por pessoa (pode ser interessado e proprietário ao mesmo tempo)
- [ ] Gerar resumo inteligente da conversa/qualificação para o corretor responsável
- [ ] Workflow de aprovação humana de documentos antes de gerar contrato (venda ou locação)
- [ ] Gerar contrato (venda ou locação) a partir de template, com dados preenchidos automaticamente
- [ ] Assinatura via PDF manual ou gov.br, com devolução por WhatsApp ou e-mail — sem vendor pago
- [ ] Cobrança recorrente de aluguel integrada a gateway de pagamento (Asaas)
- [ ] Painel administrativo com dashboard de acompanhamento (funil, visitas, contratos, cobrança)
- [ ] Vitrine pública (web, sem WhatsApp) dos imóveis disponíveis
- [ ] Autenticação para equipe interna (admin/corretor/editor) com controle de papéis

### 3.2 Diferenciais visados (do enunciado do hackathon)

| Diferencial | Status |
|---|---|
| Integração com WhatsApp | Reaproveitado — zero custo adicional |
| Multiagentes | Reaproveitado o padrão, roster reescrito (8 de cliente + 1 copiloto interno) |
| Memória conversacional | Reaproveitado — zero custo adicional |
| RAG | Mecanismo pronto + busca híbrida de imóveis nova |
| Observabilidade | Reaproveitado — zero custo adicional |
| Segurança | Reaproveitado + hash determinístico de CPF novo |
| Deploy em cloud | Reaproveitado — zero custo adicional |
| Integração com CRM | Painel próprio já cobre o essencial; webhook externo genérico fica de roadmap |
| Voice AI | STT (Whisper) pronto; TTS fica de roadmap |

### 3.3 Não-funcionais

- Tempo de resposta ao lead ≤ 45 segundos (debounce de 20s) — herdado
- Sistema deve operar 24/7 sem intervenção manual
- Toda conversa deve ser auditável pelo painel admin
- Todo lead qualificado ou com visita agendada gera resumo consultável pelo corretor em até 2 minutos
- CPF nunca trafega nem é exibido em texto plano fora do fluxo de coleta — sempre hash/criptografado at-rest, sempre mascarado em UI (seção 6.2)
- Nenhuma ação de consequência real (agendar, reservar, ver dados de contrato/pagamento) roda sem identidade confirmada — mas **buscar e conversar não exigem cadastro** (seção 6.3)
- Documentos RAG indexados em < 60 segundos após upload
- Código versionado em Git com deploy automático via Vercel

---

## 4. Cenários Esperados

Os três primeiros são do PDF do hackathon; os dois seguintes (4 e 5) vêm do fluxo de proprietário/inquilino descrito para a v2.0 e seguem o mesmo padrão de especificação.

### 4.1 Exemplo 1 — Compra

> Cliente: *"Estou procurando apartamento na zona sul."*

1. Orquestrador detecta contato sem `intent` → roteia para SDR (sem exigir cadastro — ver seção 6.3)
2. SDR entende a intenção (compra) → `save_qualification({ intent: 'compra' })`
3. Pergunta faixa de preço, quartos, região (não repete "zona sul", já veio na mensagem), urgência
4. Assim que tiver preço + região, chama `search_properties(...)` e mostra 2–3 opções reais
5. `transfer_to_agendamento` → aqui sim, pipeline exige cadastro antes de confirmar o horário (seção 6.3) → se `registration_status = 'none'`, dispara `request_registration_form('cadastro')` primeiro
6. Após cadastro completo, agenda a visita, cria `property_visits`
7. Ao confirmar, dispara `generateLeadSummary(trigger: 'visita_agendada')`

### 4.2 Exemplo 2 — Investimento

> Cliente: *"Quero investir em imóveis para renda."*

1. Orquestrador detecta `intent = investimento` → roteia para Investidor
2. Entende perfil (primeira vez investindo? já tem portfólio?), ticket disponível, expectativa de retorno
3. `transfer_to_broker(specialty: 'investimento')`
4. `generateLeadSummary(trigger: 'qualificacao_completa')` — corretor especialista recebe contexto antes de ligar

### 4.3 Exemplo 3 — Follow-up

> Cliente iniciou conversa e não respondeu.

Reaproveita o cron de follow-up da fundação sem alteração estrutural (seção 13.3): detecta inatividade por canal, busca `agent_histories` do `active_agent` corrente pra reengajar com contexto real ("vi que você buscava apê na Zona Sul até R$ 800 mil — separei mais 2 opções"), respeita quiet hours e limite de tentativas.

### 4.4 Exemplo 4 — Proprietário quer disponibilizar imóvel (novo)

> Cliente: *"Quero colocar meu apartamento para alugar."*

1. Orquestrador detecta `intent = disponibilizar_imovel` → roteia para **Proprietário**
2. Pergunta dados básicos do imóvel: tipo, endereço/região, quartos, área, características
3. Chama `get_market_comparables(region, property_type, bedrooms)` e sugere faixa de preço com base em imóveis comparáveis já na base — não impõe, apresenta como referência ("imóveis parecidos na região saem entre R$ X e R$ Y")
4. Pede fotos — aceita direto como mensagem de imagem no WhatsApp (reaproveitando o pipeline de Vision já existente) ou envia link do formulário de listagem pra quem preferir enviar em lote
5. Antes de publicar, exige cadastro completo (CPF do proprietário) — diferente da busca, aqui não tem como pular: publicar imóvel em nome de alguém exige identidade confirmada
6. Ao concluir, cria `properties` com `status = 'em_analise'` (não `'disponivel'` direto) e dispara `approval_requests(type: 'aprovacao_listagem_imovel')` — corretor/admin revisa antes de publicar na vitrine

### 4.5 Exemplo 5 — Inquilino ativo pede suporte (novo)

> Cliente: *"Preciso da segunda via do boleto deste mês"* / *"Quero encerrar meu contrato"*

1. Orquestrador detecta `contact_roles` inclui `inquilino_ativo` (ou a pergunta menciona boleto/contrato/manutenção) → roteia para **Suporte**
2. Suporte confirma identidade (CPF, se ainda não resolvido na sessão) → `get_lease_status(registration_id)`
3. Para segunda via: `get_payment_statement(deal_id)` retorna extrato + link do boleto em aberto
4. Para rescisão: `request_lease_termination(deal_id)` valida a data pedida contra `notice_period_days`/`end_date` do contrato — se dentro do prazo mínimo de aviso, registra o pedido (`deals.status = 'encerramento_solicitado'`) e escala para corretor humano confirmar; se fora do prazo, informa a data mínima possível antes de registrar
5. Para manutenção: registra o chamado e escala para atendimento humano (não há automação de manutenção física, só captura estruturada do pedido)

### 4.6 Exemplo 6 — Comprador avança pra proposta (novo)

> Depois da visita, cliente: *"Gostei, quero fazer uma proposta pra esse apartamento."*

1. Roteia pra **Closer**, agora também coberto pro lado de venda (seção 12.5)
2. Confirma imóvel e cadastro completo → `create_deal(property_id, deal_type: 'venda')` cria `deals` com `status = 'em_aprovacao'`, `sale_price_cents` inicial, e muda o imóvel pra `'reservado'`
3. `request_documents` — pra venda, tipicamente RG/CNH, comprovante de renda, e comprovante de entrada/aprovação de financiamento se não for à vista
4. Documentos, negociação de valor/condições e aprovação seguem exatamente o mesmo caminho humano da locação (seção 15) — o que muda é só o template de contrato (`contract_templates.deal_type = 'venda'`, com campos como sinal/ITBI em vez de aluguel mensal)

### 4.7 Exemplo 7 — Corretor consulta o Copiloto (novo)

> Corretor, dentro do painel: *"quais são minhas visitas hoje?"* / *"resume o histórico do lead João"*

Não passa pelo Orquestrador nem pelo WhatsApp — é o **Copiloto do Corretor** (seção 12.8), autenticado no próprio painel, respondendo com dados já escopados ao `broker_id` de quem está logado.

---

## 5. Persona e Contexto de Negócio

> Placeholder ilustrativo — trocar por um cliente real quando o projeto sair do escopo de hackathon.

**LoveHome Imóveis** — imobiliária boutique fictícia em São Paulo, atuando nas duas pontas: venda/locação para quem procura (residencial médio/alto padrão + investimento) e administração de locação para proprietários (captação, contrato, cobrança, suporte ao inquilino). Portfólio simulado de 50–150 imóveis, 4–6 corretores por especialidade (residencial, investimento, comercial).

---

## 6. Identidade e Cadastro

Esta é a peça de desenho mais nova em relação à v1.0 — vale uma seção própria porque toda a arquitetura de agentes e RLS depende dela.

### 6.1 Duas camadas de identidade, propositalmente diferentes

| Camada | Chave | Precisão | Papel |
|---|---|---|---|
| **`contacts`** (conversacional) | `phone_key` (últimos 8 dígitos) | Recall > precisão — política já validada em produção | Nunca perder o fio de uma conversa de WhatsApp, mesmo com variação de DDI/9º dígito |
| **`registrations`** (formal) | CPF (hash determinístico) | Precisão total — é identidade legal | Abrir um registro que sustenta contrato, cobrança e dado de propriedade |

Misturar as duas seria um erro: usar `phone_key` frouxo como base de um cadastro que vai virar contrato de locação é a receita pra vincular a pessoa errada a um imóvel. `contacts.registration_id` aponta pra um `registrations` só depois que o CPF foi de fato coletado e resolvido — antes disso, é só um contato conversacional, sem consequência legal nenhuma anexada a ele.

### 6.2 CPF — como armazenar com segurança

CPF é dado pessoal sensível (LGPD). Três colunas, três papéis distintos — nunca uma só:

| Coluna | Como é gerado | Pra que serve |
|---|---|---|
| `cpf_hash` | `HMAC-SHA256(cpf_normalizado, APP_ENCRYPTION_KEY)` | Determinístico → indexável → é a chave de busca ("esse CPF já existe?") sem nunca guardar o número em claro pra consulta |
| `cpf_encrypted` | AES-256-GCM (mesmo padrão de `channel_configs`) | Reversível só server-side, só quando há necessidade real (gerar contrato, por exemplo) |
| `cpf_last4` | Texto plano, só os 4 últimos dígitos | Exibição mascarada em qualquer tela (`***.***.**1-23`) — nunca o admin vê o CPF completo por padrão |

Importante: AES-GCM com IV aleatório (prática correta) não é pesquisável por igualdade — por isso o hash separado. Não usar criptografia determinística só para poder indexar; isso reduziria a segurança pra ganhar uma otimização que o hash já resolve sem abrir mão de nada.

### 6.3 Quando exigir cadastro (e quando não)

Regra central, e ponto onde a v2.0 diverge do que foi inicialmente pensado: **cadastro formal não é gate de entrada da conversa.** O próprio Exemplo 1 do hackathon mostra o lead pesquisando sem fornecer documento nenhum — e exigir CPF antes de qualquer busca é fricção que mata exatamente o problema que o desafio quer resolver (leads perdidos por atendimento pesado).

| Ação | Exige `registration_status = 'completo'`? |
|---|---|
| Conversar, tirar dúvida, buscar imóvel (SDR/Investidor/Proprietário coletando dados iniciais) | **Não** |
| Agendar visita/reunião (Agendamento) | **Sim** — pipeline intercepta e dispara `request_registration_form` antes de confirmar horário |
| Reservar unidade / enviar documentos (Closer) | **Sim** |
| Publicar imóvel na vitrine (Proprietário, no fechamento do fluxo) | **Sim** |
| Consultar extrato/contrato/pedir rescisão (Suporte) | **Sim** — aqui não tem exceção, é autoatendimento de dado pessoal |

Essa checagem é **determinística, resolvida no pipeline antes do orquestrador rotear** — não é o LLM que decide se deve pedir CPF. `resolveRegistration(contact)` roda como um passo do `process-message.ts`, ao lado do dedup e da identidade multi-canal já existentes, e expõe `registration_status: 'none' | 'pending' | 'completo'` como mais um sinal que o orquestrador e os agentes recebem prontos. Ação com consequência real não pode depender de o modelo "lembrar" de checar isso.

### 6.4 Papéis múltiplos, não um enum exclusivo

Uma pessoa pode estar procurando um apartamento pra alugar **e** ter um imóvel próprio pra disponibilizar — não é xor. Por isso `contact_roles` é uma tabela de papéis por `registration_id` (`interessado`, `proprietario`, `inquilino_ativo`), não uma coluna única em `registrations`. O formulário de cadastro (seção 6.5) pergunta via múltipla escolha, não via seleção exclusiva.

### 6.5 Formulário de cadastro — fixo, não configurável (por ora)

Dois formulários sequenciais, não um construtor genérico de campos (isso é feature grande por si só — fica documentado como Marco 4, seção 21):

1. **`cadastro`** — identidade: CPF, nome completo, e-mail, endereço, e a pergunta de papéis ("o que você quer fazer aqui?" com múltipla escolha: procurar imóvel / disponibilizar um imóvel). Gera `registrations` + `contact_roles`.
2. **`listagem_imovel`** — só pra quem marcou "disponibilizar imóvel": dados do imóvel + upload de fotos em lote. Gera/atualiza `properties` com `status = 'em_analise'`.

Ambos são rotas públicas (`app/(public)/cadastro/[token]` e `app/(public)/listar-imovel/[token]`) com token de acesso único e expiração — o link é gerado por `request_registration_form` e enviado pelo agente na própria conversa de WhatsApp.

---

## 7. Stack e Decisões de Arquitetura

### 7.1 Stack principal

Idêntica à fundação de mensageria — decisão consciente de não reabrir essas discussões, já validadas em produção — mais as integrações novas do domínio.

| Camada | Tecnologia | Justificativa |
|--------|-----------|---------------|
| Framework | Next.js (App Router) | API Routes + Server Actions + deploy Vercel nativo |
| Hosting | Vercel | Deploy automático, sem gestão de infra |
| Banco principal | Supabase PostgreSQL | RLS nativo, real-time, pgvector integrado |
| Vetores (RAG) | pgvector (Supabase) | Volume esperado (< 100k chunks) performa bem sem banco vetorial externo |
| Auth | Supabase Auth | JWT, RLS automático por usuário |
| Cache / Buffer | Redis (Upstash) | Debounce, dedup, sessões do widget |
| LLM | OpenAI (modelo configurável por agente) | Agentes + embeddings |
| Embeddings | OpenAI `text-embedding-3-small` | 1536 dim, custo/qualidade adequado para português |
| WhatsApp | Z-API + Meta Cloud API | Cobertura não-oficial e oficial |
| Cobrança recorrente | **Asaas** | API bem documentada, boleto/PIX/cartão, webhook de conciliação — ver seção 14 |
| Assinatura | **PDF + manual ou gov.br** | Sem vendor pago no início (ver seção 15) — cliente assina por conta própria e devolve por WhatsApp/e-mail |

### 7.2 Decisões herdadas (não rediscutir)

- **Sem LangChain** — tool calling nativo da OpenAI SDK.
- **Sem OpenAI Assistants API** — histórico vive no Supabase (`agent_histories`), injetado por chamada. Relevante aqui também porque o gerador de resumo (seção 12.5) precisa ler esse histórico diretamente.
- **pgvector em vez de banco vetorial externo.**

### 7.3 Decisão nova: projeto Supabase dedicado

Projeto Supabase próprio, não compartilhado com nenhum outro sistema — dados de CPF, contrato e cobrança de clientes de uma imobiliária não devem se misturar com dados de outro negócio, tanto por higiene de dados quanto por LGPD (bases distintas, controladores distintos).

### 7.4 Decisão: agenda de corretor é tabela interna, não Google Calendar por corretor

OAuth do Google Calendar por corretor é ponto de falha frágil (token expira, permissão revogada, corretor troca de conta) — principalmente ruim numa demonstração ao vivo. `broker_availability`/`broker_blocked_slots` (seção 10.7) são geridos no próprio painel e consultados via tool. `property_visits.calendar_event_id` fica reservado pra um sync opcional com Calendar real como upgrade de Marco 4, não como dependência do fluxo principal.

### 7.5 Decisão: cobrança recorrente é simulada até o Marco 3 — contrato e assinatura não precisam esperar

Mesma lógica já aplicada à "base simulada de imóveis" que o próprio hackathon pede: `deals` e `lease_payments` existem com schema completo desde o Marco 1, populados com dados sintéticos plausíveis, pra que Suporte e o painel administrativo sejam demonstráveis sem depender de uma conta Asaas real sob prazo de hackathon. A integração viva de cobrança entra no Marco 3 (seção 21). O ciclo de contrato e assinatura (seção 15) **não** tem essa mesma limitação — como não depende de vendor externo, já é funcional de verdade desde o Marco 2, não só simulado.

---

## 8. Estrutura do Projeto

```
lovehome-ai/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── (public)/                       # ★ Novo — sem autenticação
│   │   ├── imoveis/                    # Vitrine pública (só status=disponivel)
│   │   │   └── [id]/page.tsx
│   │   ├── cadastro/[token]/page.tsx   # Formulário de identidade
│   │   └── listar-imovel/[token]/page.tsx  # Formulário de listagem + fotos
│   ├── (admin)/
│   │   ├── layout.tsx                  # Guard de auth — reaproveitado
│   │   ├── dashboard/
│   │   ├── painel/                     # Kanban de atendimento humano
│   │   ├── conversas/[id]/
│   │   ├── leads/[id]/                 # Contato + registration (se houver) + papéis
│   │   ├── imoveis/                    # CRUD da base de imóveis
│   │   ├── proprietarios/              # ★ Registrations com papel 'proprietario'
│   │   ├── visitas/
│   │   ├── contratos/                  # ★ CRUD de deals (venda + locação) + aprovação
│   │   ├── pagamentos/                 # ★ lease_payments + status Asaas
│   │   ├── documentos/                 # ★ Fila de aprovação de documentos
│   │   ├── formularios/                # ★ form_submissions (pendentes/preenchidos)
│   │   ├── corretores/                 # Roster + broker_availability
│   │   ├── resumos/
│   │   ├── atendimento/
│   │   ├── agentes/
│   │   ├── canais/                     # Credenciais Z-API/Meta/Widget/Asaas (criptografadas)
│   │   ├── sites/
│   │   ├── materiais/
│   │   ├── depoimentos/
│   │   └── configuracoes/
│   └── api/
│       ├── webhook/
│       │   ├── zapi/route.ts
│       │   ├── meta/route.ts
│       │   └── asaas/route.ts          # ★ Novo
│       ├── widget/
│       ├── admin/
│       │   ├── leads/ · properties/ · visits/ · brokers/ · summaries/
│       │   ├── registrations/          # ★
│       │   ├── deals/                  # ★
│       │   ├── payments/               # ★
│       │   ├── documents/              # ★
│       │   ├── form-submissions/       # ★
│       │   └── copiloto/               # ★ Chat do Copiloto do Corretor (autenticado)
│       ├── public/
│       │   ├── properties/route.ts     # ★ Leitura pública (vitrine)
│       │   ├── registration/route.ts   # ★ Submissão do formulário de cadastro
│       │   └── property-listing/route.ts  # ★ Submissão do formulário de imóvel
│       ├── cron/followup/
│       └── rag/
├── lib/
│   ├── channels/                       # Reaproveitado sem alterações
│   ├── pipeline/
│   │   ├── process-message.ts          # Adaptado — ganha resolveRegistration()
│   │   └── resolve-registration.ts     # ★ Novo — checagem determinística
│   ├── agents/
│   │   ├── orchestrator.ts
│   │   ├── base-agent.ts
│   │   ├── sdr.ts · investidor.ts
│   │   ├── proprietario.ts             # ★ Novo
│   │   ├── agendamento.ts · closer.ts · suporte.ts
│   │   ├── summary.ts
│   │   ├── copiloto.ts                 # ★ Novo — não passa pelo orquestrador, chamado direto do painel
│   │   └── tools/
│   │       ├── properties.ts           # search_properties, get_market_comparables
│   │       ├── qualification.ts
│   │       ├── registration.ts         # ★ request_registration_form
│   │       ├── visits.ts               # check_broker_availability, create_visit
│   │       ├── leasing.ts              # ★ create_deal, request_documents
│   │       ├── support.ts              # ★ get_payment_statement, get_lease_status, request_lease_termination
│   │       └── copiloto.ts             # ★ get_my_agenda, get_pending_documents, get_deal_status
│   ├── registrations/                  # ★ Novo
│   │   ├── cpf.ts                      # normalização, validação de dígito verificador, hash
│   │   └── roles.ts
│   ├── leasing/                        # ★ Novo
│   │   ├── contract-template.ts        # Preenchimento de template
│   │   └── notice-period.ts            # Validação de prazo de rescisão
│   ├── asaas/                          # ★ Novo
│   │   ├── client.ts                   # Cliente REST Asaas
│   │   └── webhook.ts                  # Validação + parsing de evento
│   ├── crypto/
│   │   └── encrypt.ts                  # Reaproveitado — AES-256-GCM + novo helper de HMAC
│   ├── rag/
│   ├── whatsapp/
│   ├── redis/ · redis-buffer/
│   ├── supabase/
│   ├── types/
│   └── utils/
├── public/
│   └── widget.js
├── supabase/
│   └── migrations/
└── middleware.ts
```

`★` marca o que é novo em relação à v1.0 deste PRD.

---

## 9. Autenticação e Papéis

### 9.1 Estratégia

Supabase Auth com e-mail/senha para equipe interna (admin, corretores, editores). Cadastro de cliente (`registrations`) é um registro de negócio, não uma conta de login — nem interessado, nem proprietário, nem inquilino fazem login no painel; interagem via WhatsApp, widget ou os formulários públicos tokenizados.

### 9.2 Roles internas

| Role | Acesso |
|------|--------|
| `admin` | Acesso total |
| `corretor` | Vê e atende apenas leads/visitas/contratos atribuídos a si (`assigned_broker_id`) |
| `editor` | Gestão de imóveis e materiais RAG — sem acesso a dados de leads/contratos |
| `viewer` | Somente leitura |

### 9.3 RLS — escopo por corretor

```sql
CREATE POLICY "Corretor ve apenas leads atribuidos"
  ON contacts FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'viewer'))
    OR EXISTS (SELECT 1 FROM brokers b WHERE b.profile_id = auth.uid() AND b.id = contacts.assigned_broker_id)
  );

-- Mesmo padrão em property_visits, deals e properties — inclusive pro Copiloto do Corretor (seção 12.8)
CREATE POLICY "Corretor ve apenas seus negocios"
  ON deals FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'viewer'))
    OR EXISTS (SELECT 1 FROM brokers b WHERE b.profile_id = auth.uid() AND b.id = deals.broker_id)
  );

CREATE POLICY "Corretor gerencia apenas seus imoveis"
  ON properties FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'viewer', 'editor'))
    OR EXISTS (SELECT 1 FROM brokers b WHERE b.profile_id = auth.uid() AND b.id = properties.broker_id)
  );
```

Fora isso, postura de segurança herdada sem alterações: RLS deny-all pra `anon` em tabelas sensíveis, `service_role` bypassando por trás do server, timing-safe compare em validação de secrets.

---

## 10. Banco de Dados — Schema

### 10.1 Tabelas reaproveitadas sem alteração estrutural

Migrations de conversa, chaveadas por `contact_id`: `conversations`, `messages`, `agent_histories` (enum de `agent` atualizado), `message_traces`, `routing_logs`, `human_takeover_logs`, `webhook_logs`, `contact_identities`, `widget_sessions`/`widget_sites`, `channel_configs` (enum de `channel` inclui `asaas`), `agent_configs`, `rag_documents`/`rag_chunks`, `testimonials`, `contact_blocklist`.

### 10.2 Identidade — `contacts`, `registrations`, `contact_roles`

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'corretor', 'editor', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Identidade formal — CPF nunca em texto plano (ver seção 6.2)
CREATE TABLE registrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cpf_hash TEXT NOT NULL UNIQUE,         -- HMAC-SHA256(cpf, APP_ENCRYPTION_KEY) — indexável, não reversível
  cpf_encrypted TEXT NOT NULL,           -- AES-256-GCM — reversível só server-side quando necessário
  cpf_last4 TEXT NOT NULL,               -- exibição mascarada
  full_name TEXT NOT NULL,
  email TEXT,
  birth_date DATE,
  address JSONB,                         -- {street, number, complement, neighborhood, city, state, zip}
  income_declared_cents INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_registrations_cpf_hash ON registrations(cpf_hash);

-- Papéis múltiplos, não exclusivos — ver seção 6.4
CREATE TABLE contact_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('interessado', 'proprietario', 'inquilino_ativo')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(registration_id, role)
);

-- Identidade conversacional — leve, sem consequência legal anexada
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT,
  phone_key TEXT UNIQUE,
  name TEXT,
  channel_default TEXT DEFAULT 'zapi' CHECK (channel_default IN ('zapi', 'meta', 'widget')),

  registration_id UUID REFERENCES registrations(id),
  registration_status TEXT NOT NULL DEFAULT 'none'
    CHECK (registration_status IN ('none', 'pending', 'completo')),

  funnel_stage TEXT NOT NULL DEFAULT 'novo'
    CHECK (funnel_stage IN ('novo', 'qualificando', 'qualificado', 'visita_agendada', 'em_negociacao', 'convertido', 'perdido')),
  intent TEXT CHECK (intent IN ('compra', 'aluguel', 'investimento', 'disponibilizar_imovel')),
  active_agent TEXT CHECK (active_agent IN ('sdr', 'investidor', 'proprietario', 'agendamento', 'closer', 'suporte')),
  assigned_broker_id UUID REFERENCES brokers(id),

  last_contact TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_contacts_phone_key ON contacts(phone_key);
CREATE INDEX idx_contacts_funnel ON contacts(funnel_stage);
CREATE INDEX idx_contacts_registration ON contacts(registration_id) WHERE registration_id IS NOT NULL;

ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_roles ENABLE ROW LEVEL SECURITY;
```

### 10.3 `lead_qualifications` (reaproveitado da v1.0, sem alteração)

```sql
CREATE TABLE lead_qualifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  intent TEXT CHECK (intent IN ('compra', 'aluguel', 'investimento')),
  price_min_cents INTEGER,
  price_max_cents INTEGER,
  bedrooms INTEGER,
  region TEXT,
  city TEXT DEFAULT 'São Paulo',
  property_type TEXT,
  urgency TEXT CHECK (urgency IN ('imediata', 'ate_30_dias', 'ate_90_dias', 'sem_pressa')),
  investor_ticket_cents INTEGER,
  investor_return_expectation TEXT,
  investor_has_portfolio BOOLEAN,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id)
);
```

### 10.4 `properties` (adaptado — ganha vínculo com proprietário e status de análise)

```sql
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference_code TEXT UNIQUE,
  title TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('venda', 'aluguel', 'ambos')),
  property_type TEXT NOT NULL,

  price_cents INTEGER,
  rent_price_cents INTEGER,
  condo_fee_cents INTEGER,

  bedrooms INTEGER,
  suites INTEGER,
  bathrooms INTEGER,
  parking_spots INTEGER,
  area_m2 NUMERIC,

  region TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'São Paulo',
  address TEXT,

  description TEXT,
  amenities JSONB DEFAULT '[]',
  photos JSONB DEFAULT '[]',

  status TEXT NOT NULL DEFAULT 'disponivel'
    CHECK (status IN ('em_analise', 'disponivel', 'reservado', 'vendido', 'alugado', 'inativo')),
  owner_registration_id UUID REFERENCES registrations(id),   -- ★ novo — quem listou o imóvel
  broker_id UUID REFERENCES brokers(id),

  embedding vector(1536),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_properties_filters ON properties(operation, property_type, region, status);
CREATE INDEX idx_properties_price ON properties(price_cents);
CREATE INDEX idx_properties_owner ON properties(owner_registration_id) WHERE owner_registration_id IS NOT NULL;
CREATE INDEX ON properties USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
```

Imóveis publicados por proprietário via chat nascem com `status = 'em_analise'` — só viram `'disponivel'` (e aparecem na vitrine pública) depois de aprovados (seção 10.6). Imóveis do portfólio simulado (seed inicial) nascem direto como `'disponivel'`.

### 10.5 `brokers`, `broker_availability`, `broker_blocked_slots`

```sql
CREATE TABLE brokers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID REFERENCES profiles(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  specialty TEXT CHECK (specialty IN ('residencial', 'investimento', 'comercial', 'geral')),
  region_focus TEXT[],
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Disponibilidade recorrente (ex: seg-sex 9h-18h) — consultada por check_broker_availability
CREATE TABLE broker_availability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  broker_id UUID NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bloqueios pontuais (folga, compromisso específico)
CREATE TABLE broker_blocked_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  broker_id UUID NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE brokers ENABLE ROW LEVEL SECURITY;
```

### 10.6 `property_visits`, `form_submissions`, `documents`, `approval_requests`

```sql
CREATE TABLE property_visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id),
  broker_id UUID REFERENCES brokers(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL DEFAULT 'visita'
    CHECK (type IN ('visita', 'reuniao_investidor', 'call_apresentacao')),
  status TEXT NOT NULL DEFAULT 'agendada'
    CHECK (status IN ('agendada', 'confirmada', 'realizada', 'cancelada', 'no_show')),
  calendar_event_id TEXT,               -- reservado pra sync opcional futuro (seção 7.4)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Formulários públicos tokenizados — cadastro e listagem de imóvel (seção 6.5)
CREATE TABLE form_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  form_type TEXT NOT NULL CHECK (form_type IN ('cadastro', 'listagem_imovel')),
  contact_id UUID REFERENCES contacts(id),
  registration_id UUID REFERENCES registrations(id),
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'preenchido', 'expirado')),
  payload JSONB DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Documentos anexados — identidade, comprovantes, escritura
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  registration_id UUID REFERENCES registrations(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('rg_cnh', 'comprovante_renda', 'comprovante_residencia', 'escritura_imovel', 'outro')),
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente_revisao'
    CHECK (status IN ('pendente_revisao', 'aprovado', 'rejeitado')),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Gate humano antes de publicar imóvel ou gerar contrato (venda ou locação)
CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('aprovacao_listagem_imovel', 'aprovacao_locacao', 'aprovacao_venda')),
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'aprovado', 'rejeitado', 'info_solicitada')),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (property_id IS NOT NULL OR deal_id IS NOT NULL)
);

CREATE INDEX idx_visits_contact ON property_visits(contact_id);
CREATE INDEX idx_visits_broker ON property_visits(broker_id);
CREATE INDEX idx_approval_status ON approval_requests(status) WHERE status = 'pendente';

ALTER TABLE property_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
```

### 10.7 `deals`, `lease_payments`, `contract_templates`

`deals` cobre **venda e locação na mesma tabela** — o ciclo de aprovação/contrato/assinatura é idêntico nos dois casos (seção 15), só a parte financeira diverge. Unificar evita duplicar `approval_requests`/`documents`/lógica de contrato pra cada tipo de negócio.

```sql
CREATE TABLE contract_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_type TEXT NOT NULL CHECK (deal_type IN ('locacao', 'venda')),
  name TEXT NOT NULL,
  body_template TEXT NOT NULL,          -- placeholders: {{tenant_name}}, {{property_address}}, {{rent_price}} ou {{sale_price}}...
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_type TEXT NOT NULL CHECK (deal_type IN ('locacao', 'venda')),
  property_id UUID NOT NULL REFERENCES properties(id),
  client_registration_id UUID NOT NULL REFERENCES registrations(id),   -- locatário OU comprador
  owner_registration_id UUID REFERENCES registrations(id),
  broker_id UUID REFERENCES brokers(id),

  status TEXT NOT NULL DEFAULT 'em_aprovacao'
    CHECK (status IN ('em_aprovacao', 'aprovado', 'ativo', 'encerramento_solicitado', 'encerrado', 'concluido', 'cancelado')),

  -- Campos de locação — NULL quando deal_type = 'venda'
  rent_price_cents INTEGER,
  start_date DATE,
  end_date DATE,
  notice_period_days INTEGER DEFAULT 30,
  termination_requested_at TIMESTAMPTZ,
  termination_effective_date DATE,
  asaas_subscription_id TEXT,

  -- Campos de venda — NULL quando deal_type = 'locacao'
  sale_price_cents INTEGER,
  down_payment_cents INTEGER,             -- sinal
  financing_type TEXT CHECK (financing_type IN ('a_vista', 'financiado', 'consorcio')),
  itbi_status TEXT CHECK (itbi_status IN ('pendente', 'pago')),

  -- Contrato e assinatura — comum aos dois tipos (seção 15)
  contract_template_id UUID REFERENCES contract_templates(id),
  contract_document_url TEXT,             -- PDF gerado, não assinado
  signature_method TEXT CHECK (signature_method IN ('manual', 'govbr')),
  signed_document_url TEXT,               -- PDF assinado, devolvido pelo cliente
  signed_returned_via TEXT CHECK (signed_returned_via IN ('whatsapp', 'email')),
  contract_signed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cobrança recorrente — só existe pra deal_type='locacao' (venda não tem mensalidade)
CREATE TABLE lease_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  reference_month DATE NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'pago', 'atrasado', 'cancelado')),
  due_date DATE NOT NULL,
  paid_at TIMESTAMPTZ,
  asaas_payment_id TEXT,
  boleto_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(deal_id, reference_month)
);

CREATE INDEX idx_deals_client ON deals(client_registration_id);
CREATE INDEX idx_deals_property ON deals(property_id);
CREATE INDEX idx_deals_broker ON deals(broker_id);
CREATE INDEX idx_deals_type_status ON deals(deal_type, status);
CREATE INDEX idx_payments_deal ON lease_payments(deal_id);
CREATE INDEX idx_payments_asaas ON lease_payments(asaas_payment_id) WHERE asaas_payment_id IS NOT NULL;

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE lease_payments ENABLE ROW LEVEL SECURITY;
```

### 10.8 `lead_summaries` (reaproveitado da v1.0, sem alteração)

```sql
CREATE TABLE lead_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  broker_id UUID REFERENCES brokers(id),
  trigger TEXT NOT NULL
    CHECK (trigger IN ('qualificacao_completa', 'visita_agendada', 'reengajamento', 'manual')),
  summary_text TEXT NOT NULL,
  structured_data JSONB DEFAULT '{}',
  sent_via TEXT CHECK (sent_via IN ('dashboard', 'whatsapp', 'email')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE lead_summaries ENABLE ROW LEVEL SECURITY;
```

### 10.9 Tabelas sem equivalente neste domínio

Não há tabelas de curso, matrícula ou venda de infoproduto — o domínio é imobiliário, e a cobrança vive em `lease_payments`/Asaas (seção 14).

---

## 11. Sistema RAG e Busca de Imóveis

### 11.1 RAG institucional (mecanismo 100% reaproveitado)

`chunker.ts`/`embedder.ts`/`retriever.ts` migram sem alteração de lógica. Conteúdo indexado: condições de financiamento, documentação necessária, glossário de termos (ITBI, escritura, caução, prazo de aviso prévio), políticas da imobiliária. Usado pelo Suporte e ocasionalmente pelo SDR/Proprietário quando surge dúvida de processo no meio da conversa.

### 11.2 Busca híbrida de imóveis (reaproveitado da v1.0)

`search_properties` combina filtro estruturado (preço/quartos/região/operação) com reranking semântico opcional sobre `description` para pedidos qualitativos ("perto de metrô", "vista pro parque"). O filtro estruturado sempre roda primeiro e define o conjunto elegível — a busca semântica só reordena dentro dele, nunca substitui o filtro. Ver detalhamento completo (schema da tool + handler) no histórico deste PRD; lógica inalterada na v2.0.

### 11.3 Comparáveis de mercado — novo, para o agente Proprietário

```typescript
// lib/agents/tools/properties.ts

export const getMarketComparablesTool = {
  type: 'function' as const,
  function: {
    name: 'get_market_comparables',
    description: `Busca imóveis comparáveis já publicados na base pra sugerir uma faixa de
preço a um proprietário que quer disponibilizar um imóvel. Nunca apresente como avaliação
oficial — é uma referência de mercado com base no que já está publicado, não um laudo.`,
    parameters: {
      type: 'object',
      properties: {
        region: { type: 'string' },
        property_type: { type: 'string' },
        bedrooms: { type: 'number' },
        operation: { type: 'string', enum: ['venda', 'aluguel'] },
      },
      required: ['region', 'property_type', 'operation'],
    },
  },
}
```

```typescript
// lib/agents/tools/properties.handler.ts

export async function handleGetMarketComparables(params: MarketComparablesParams) {
  const supabase = createClient()

  const priceColumn = params.operation === 'aluguel' ? 'rent_price_cents' : 'price_cents'

  const { data } = await supabase
    .from('properties')
    .select(`${priceColumn}, area_m2, bedrooms`)
    .eq('region', params.region)
    .eq('property_type', params.property_type)
    .eq('status', 'disponivel')
    .not(priceColumn, 'is', null)
    .limit(30)

  if (!data || data.length < 3) {
    return { found: false, message: 'Poucos comparáveis nessa região/tipo — sugerir preço com cautela ou escalar para corretor.' }
  }

  const prices = data.map((p) => p[priceColumn]).sort((a, b) => a - b)
  return {
    found: true,
    sampleSize: prices.length,
    priceMin: prices[0],
    priceMedian: prices[Math.floor(prices.length / 2)],
    priceMax: prices[prices.length - 1],
  }
}
```

**Regra de negócio:** com menos de 3 comparáveis, o agente não arrisca sugerir número — comunica que a amostra é pequena e oferece encaminhar para um corretor avaliar. Evita uma sugestão de preço mal calibrada virar a âncora da conversa com o proprietário.

---

## 12. Sistema Multiagente

### 12.1 Roster de agentes (8 voltados a cliente + 1 copiloto interno)

| Agente | Origem | Papel |
|---|---|---|
| **Orquestrador** | Adaptado | Roteia com base em intent/funnel_stage/active_agent/`registration_status`/`contact_roles` |
| **SDR** | Reescrito | Qualifica compra/aluguel, busca imóveis — Exemplo 1 |
| **Investidor** | Reaproveitado da v1.0 | Qualifica perfil investidor — Exemplo 2 |
| **Proprietário** | Novo | Coleta imóvel a disponibilizar, sugere preço, recebe fotos — Exemplo 4 |
| **Agendamento** | Adaptado | Consulta `broker_availability`, cria `property_visits` |
| **Closer** | Reintroduzido | Reserva/proposta (venda ou locação) + coleta de documentos → `approval_requests` — Exemplo 6 |
| **Suporte** | Ampliado | Extrato, status de contrato, rescisão — Exemplo 5 |
| **Despedida** | Reaproveitado | Template, sem LLM |
| **Copiloto do Corretor** | Novo, interno | Vive no painel, não no WhatsApp do cliente — seção 12.8, Exemplo 7 |

### 12.2 Orquestrador — regras de roteamento

```
Analise a mensagem e o perfil do contato. Retorne o agente responsável.

Perfil do contato:
- registration_status: {registration_status}
- contact_roles: {contact_roles}
- funnel_stage: {funnel_stage}
- intent: {intent}
- active_agent: {active_agent}

Regras:
- active_agent definido → vai direto pra ele (evita loop de reclassificação)
- "obrigado", "valeu", "até mais" → despedida (prioridade 1, sempre)
- intent=disponibilizar_imovel OU contact_roles inclui 'proprietario' em conversa nova → proprietario
- intent=investimento (dito ou inferido) → investidor
- contact_roles inclui 'inquilino_ativo' AND (pagamento/boleto/contrato/manutenção/rescisão) → suporte
- menciona "reservar", "quero esse imóvel", "enviar documentos" → closer
- menciona agendar/visitar/marcar horário → agendamento
- sem intent definido → sdr
- ambiguidade → sdr

Responda SOMENTE em JSON:
{"agent": "sdr|investidor|proprietario|agendamento|closer|suporte|despedida", "reasoning": "..."}
```

Nota: a checagem de `registration_status` **não** entra como regra de roteamento do orquestrador — ela é resolvida antes, no pipeline (seção 6.3), e intercepta a ação (agendar/reservar/publicar/consultar) independente de qual agente está ativo. O orquestrador escolhe o agente pelo conteúdo da conversa; o pipeline decide se aquela ação específica pode prosseguir sem cadastro.

### 12.3 SDR e Investidor

Sem alteração de conteúdo em relação à v1.0 — prompts e tools (`save_qualification`, `search_properties`, `transfer_to_investidor`, `transfer_to_agendamento`, `transfer_to_broker`) seguem os mesmos.

### 12.4 Proprietário (novo)

```
Você atende quem quer disponibilizar um imóvel na LoveHome — pra alugar ou vender.
Seu papel é coletar os dados do imóvel e já dar uma primeira referência de preço,
sem soar como avaliação oficial.

Ordem natural:
1. Tipo de imóvel, endereço/região, quartos, área
2. Assim que tiver região + tipo, chame get_market_comparables e apresente como
   referência ("imóveis parecidos na região saem entre X e Y"), nunca como valor fechado
3. Peça fotos — aceite direto se a pessoa mandar imagem no WhatsApp; se preferir,
   ofereça o link do formulário pra enviar várias de uma vez
4. Antes de publicar, é obrigatório ter cadastro completo (CPF) — explique que é
   necessário pra vincular o imóvel ao nome do proprietário

Ao final, chame submit_property_listing — isso cria o imóvel como 'em_analise',
não publica direto. Avise que um corretor revisa antes de ir ao ar.
```

Tools: `get_market_comparables`, `save_property_draft`, `request_registration_form`, `submit_property_listing`

Fotos recebidas como mensagem de imagem no WhatsApp reaproveitam o mesmo pipeline de mídia já usado para Vision (`lib/whatsapp/media.ts`) — não é preciso construir um caminho de upload separado pra esse caso, só anexar ao rascunho do imóvel em vez de interpretar a imagem como pergunta.

### 12.5 Agendamento e Closer

**Agendamento** — `check_broker_availability` consulta `broker_availability`/`broker_blocked_slots` em vez de Google Calendar; `create_event` grava em `property_visits`; dispara `generateLeadSummary(trigger: 'visita_agendada')` ao confirmar. Exige `registration_status = 'completo'` (seção 6.3).

**Closer (escopo novo — venda e locação)**

```
Você conduz a reserva de uma unidade (aluguel) ou o início de uma proposta
(venda) depois que o lead já decidiu qual imóvel quer. Seu papel termina na
coleta de documentos — a negociação de condições, a aprovação e o contrato
em si são conduzidos por um corretor humano.

1. Confirme qual imóvel (property_id), se é venda ou locação, e que a pessoa
   tem cadastro completo
2. Chame create_deal — isso cria um deal com status 'em_aprovacao' no tipo
   correto e muda o imóvel pra 'reservado' (evita duas pessoas no mesmo imóvel)
3. Chame request_documents com a lista certa pro tipo de negócio:
   - Locação: RG/CNH, comprovante de renda, comprovante de residência
   - Venda: RG/CNH, comprovante de renda, comprovante de entrada ou
     aprovação de financiamento (se não for à vista)
4. Conforme os documentos chegam (anexados no WhatsApp ou pelo link do formulário),
   confirme recebimento — não avalie o conteúdo, isso é revisão humana
5. Avise que a equipe vai analisar e retornar em até X dias úteis
```

Tools: `create_deal`, `request_documents`, `confirm_document_received`

`create_deal` é o ponto onde o Closer diverge do desenho da v1.0: lá, "fechar" significava link de pagamento de produto digital; aqui significa criar um registro `deals` em estado `em_aprovacao` (venda ou locação) e travar o imóvel — a decisão final continua sendo humana, via `approval_requests` (seção 10.6). Documentos recebidos como anexo de PDF no WhatsApp usam o mesmo pipeline de mídia, com um handler novo pra tipo `document` (além dos já existentes de imagem/áudio).

### 12.6 Suporte (ampliado)

```
Você dá suporte a quem já é inquilino ativo da LoveHome.
Confirme a identidade (CPF) antes de expor qualquer dado de contrato ou pagamento —
nunca assuma que quem está no número de telefone é o titular do contrato.

Casos comuns:
- Segunda via de boleto / extrato → get_payment_statement
- Status e prazos do contrato → get_lease_status
- Pedido de rescisão → request_lease_termination (valida contra o prazo mínimo
  de aviso do contrato; se a data pedida for menor que o prazo, informe a
  data mínima possível antes de registrar)
- Manutenção → registre o pedido e escale pra atendimento humano

Nunca invente status de pagamento ou data de contrato — sempre confirme via tool.
```

Tools: `get_payment_statement`, `get_lease_status`, `request_lease_termination`, `escalate_to_human`

### 12.7 Gerador de resumo e Despedida

Sem alteração em relação à v1.0 — `generateLeadSummary` (seção correspondente do histórico deste PRD) e o agente Despedida seguem como estavam.

### 12.8 Copiloto do Corretor (novo — assistente interno, não conversa com cliente)

Diferente dos outros sete, este não é roteado pelo Orquestrador nem fala com quem procura ou oferece imóvel — vive **dentro do painel**, autenticado via Supabase Auth. Isso já resolve identidade sem precisar detectar "esse telefone é de um corretor" no mesmo número público usado por clientes, o que seria abrir risco de segurança à toa (spoofing de número virando "comando interno").

Perguntas típicas: *"quais são minhas visitas hoje?"*, *"resume o histórico do lead João"*, *"quais documentos ainda faltam no negócio da Maria?"*, *"quais imóveis combinam com o perfil desse investidor?"*.

Tools: `get_my_agenda(broker_id, date_range)`, `get_lead_summary(contact_id)`, `get_pending_documents(broker_id)`, `get_deal_status(deal_id)`, `search_properties` (reaproveitada).

Toda tool filtra por `broker_id` do usuário autenticado — mesmo escopo da RLS da seção 9.3, então um bug de prompt não vaza dado de outro corretor por engano. Fica de Marco 2 (não bloqueia os cenários 1–3 do hackathon); uma versão por WhatsApp com número interno separado é possível depois, mas login no painel já resolve o essencial sem misturar canais.

---

## 13. Integração WhatsApp e Multi-canal

Reaproveitado da fundação sem alterações de arquitetura: webhook + debounce Redis (TTL 20s), envio fracionado, follow-up cron por janela de inatividade e canal, mídia (Whisper/Vision). Ver seção 12.4 para o reaproveitamento específico do pipeline de imagem no fluxo do Proprietário.

---

## 14. Integração de Pagamentos (Asaas)

### 14.1 Por que Asaas

API REST bem documentada, cobre boleto/PIX/cartão e cobrança recorrente — adequado pra mensalidade de aluguel. Não é uma integração nova em espírito: é **o mesmo formato de integração de pagamento** (webhook autenticado + reconciliação por id externo), só que apontando pra outro domínio de evento (pagamento de aluguel em vez de venda de curso).

### 14.2 Webhook — recebimento

```
POST /api/webhook/asaas
```

- Valida o token de webhook configurado no Asaas (header customizado, comparado contra `channel_configs` com `channel='asaas'`, criptografado — mesmo padrão dos outros segredos de canal)
- Eventos relevantes: `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_DELETED`, `PAYMENT_UPDATED`
- Atualiza `lease_payments.status` por `asaas_payment_id`
- Dedup por `(asaas_payment_id, event)` — o papel que `(platform, transaction_id)` cumpre em integrações de pagamento em geral

### 14.3 Geração de cobrança

Ao ativar um `deal` de **locação** (`status = 'ativo'`, contrato assinado), cria-se uma assinatura recorrente no Asaas (`asaas_subscription_id`) e, mensalmente, um registro correspondente em `lease_payments` com o boleto/link de pagamento gerado. Venda não gera assinatura recorrente — no máximo uma cobrança avulsa do sinal (`down_payment_cents`), se a imobiliária optar por processar isso pelo Asaas também; não é o foco desta seção.

### 14.4 Escopo por marco

Schema completo desde o Marco 1, com `lease_payments` populado por dados simulados (sem chamada real à API do Asaas) até o Marco 3 — mesma lógica já usada pra "base simulada de imóveis". Integração viva entra no Marco 3 (seção 21), quando fizer sentido operar com conta Asaas real.

---

## 15. Contratos e Assinatura Eletrônica

### 15.1 Geração de contrato

`contract_templates.body_template` guarda o texto do contrato com placeholders (`{{tenant_name}}`, `{{owner_name}}`, `{{property_address}}`, `{{rent_price}}` ou `{{sale_price}}`, `{{start_date}}`, `{{end_date}}`, `{{notice_period_days}}`...). `lib/leasing/contract-template.ts` faz o preenchimento a partir de `deals` + `registrations` + `properties`, gerando o documento (PDF) salvo em `deals.contract_document_url`. Existe um template por `deal_type` — venda e locação têm cláusulas diferentes.

### 15.2 Aprovação antes do contrato

`approval_requests(type='aprovacao_locacao' | 'aprovacao_venda')` é o gate humano entre "documentos recebidos pelo Closer" e "contrato gerado": um corretor/admin revisa os `documents` anexados (`status: pendente_revisao → aprovado/rejeitado`) e só então aprova o negócio, o que libera a geração do contrato. Nenhum contrato é gerado ou enviado pra assinatura sem essa aprovação explícita — não existe caminho automatizado que pule esse humano no meio.

### 15.3 Assinatura — decisão: sem vendor pago no início

Definido: nada de ClickSign/D4Sign/Autentique por ora — é custo e integração de API que não se justificam antes de validar o resto do fluxo. O caminho inicial é mais simples e já é assinatura válida:

1. Contrato gerado em PDF (seção 15.1) — o corretor envia ao cliente por fora (WhatsApp ou e-mail), sem automação nessa ponta
2. Cliente assina por conta própria: **manualmente** (imprime, assina, digitaliza/fotografa) ou via **gov.br** (assinatura eletrônica oficial do governo, gratuita — o cliente usa uma ferramenta que já tem, LoveHome não integra API nenhuma pra isso)
3. Cliente devolve o PDF assinado — por **WhatsApp** (anexo de documento; o pipeline de mídia ganha um handler pra tipo `document`, ao lado dos já existentes de imagem/áudio) ou por **e-mail** (recebido na caixa da própria equipe; no Marco 1/2 o corretor faz upload manual do anexo em `/contratos` — ingestão automática de e-mail é integração à parte que não parece valer o custo agora)
4. `deals.signature_method` registra o caminho usado (`'manual'` ou `'govbr'`), `deals.signed_document_url` guarda o PDF devolvido, `deals.signed_returned_via` registra o canal (`'whatsapp'` ou `'email'`), `deals.contract_signed_at` é preenchido no momento do recebimento

Essa decisão **simplifica o roadmap**: como não depende de escolher/integrar um vendor, o ciclo completo (geração → aprovação → assinatura → devolução) já é viável no Marco 2, sem esperar o Marco 3 (seção 21). Se no futuro fizer sentido automatizar mais (rastrear quem abriu o link, lembrete automático de assinatura pendente), aí sim vale reavaliar um vendor pago — fica documentado como possível item de Marco 4, não como dependência de agora.

---

## 16. API Routes — Contrato

### Webhook

| Método | Path | Descrição |
|--------|------|-----------|
| POST | `/api/webhook/zapi` | Recebe mensagens Z-API |
| GET/POST | `/api/webhook/meta` | Recebe mensagens Meta Cloud API |
| POST | `/api/webhook/asaas` | Recebe eventos de pagamento |

### Público (sem autenticação)

| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/api/public/properties` | Lista imóveis disponíveis (vitrine) |
| POST | `/api/public/registration` | Submissão do formulário de cadastro |
| POST | `/api/public/property-listing` | Submissão do formulário de listagem de imóvel |

### Domínio imobiliário (admin)

| Método | Path | Descrição |
|--------|------|-----------|
| GET/POST | `/api/admin/properties` | CRUD imóveis |
| PATCH | `/api/admin/properties/[id]/approve` | Aprova/rejeita listagem (`em_analise` → `disponivel`) |
| GET/POST | `/api/admin/visits` | Visitas |
| GET/POST | `/api/admin/brokers` | Corretores + disponibilidade |
| GET | `/api/admin/summaries` | Resumos gerados |
| GET | `/api/admin/leads` | Contatos com filtros |
| GET | `/api/admin/registrations` | Cadastros formais |
| GET/POST | `/api/admin/deals` | Negócios — venda e locação |
| PATCH | `/api/admin/deals/[id]/approve` | Aprova o negócio, libera geração de contrato |
| POST | `/api/admin/deals/[id]/signed-document` | Upload manual do PDF assinado devolvido por e-mail |
| GET | `/api/admin/payments` | `lease_payments` + status Asaas |
| GET/PATCH | `/api/admin/documents` | Fila de revisão de documentos |
| GET | `/api/admin/form-submissions` | Formulários pendentes/preenchidos |
| GET | `/api/admin/copiloto` | Consultas do Copiloto do Corretor (seção 12.8) |

### RAG e Admin (reaproveitado)

| Método | Path | Descrição |
|--------|------|-----------|
| POST | `/api/rag/upload` | Upload e indexação de documento institucional |
| GET | `/api/admin/conversations` | Lista conversas |
| GET | `/api/admin/metrics` | Dashboard |
| POST | `/api/admin/takeover` | Assumir/devolver conversa |
| GET | `/api/cron/followup` | Executa follow-up (Bearer CRON_SECRET) |

---

## 17. Painel Administrativo e Vitrine Pública

### 17.1 Telas internas

**Dashboard** — funil de leads, distribuição por intenção, visitas da semana, contratos em aprovação, cobranças em atraso.

**Painel** (Kanban) — reaproveitado.

**Leads** — contato + registration (se houver) + papéis, lado a lado com a conversa.

**Imóveis** — CRUD, incluindo fila de `em_analise` pra aprovar/rejeitar listagens de proprietário.

**Proprietários** — `registrations` com papel `proprietario`, seus imóveis, status de cada um.

**Contratos** — `deals` (venda e locação), workflow de aprovação (`approval_requests`), geração de contrato, status de assinatura (manual/gov.br, PDF devolvido por WhatsApp/e-mail).

**Pagamentos** — `lease_payments` (recorrência de aluguel), reconciliação com Asaas, inadimplência.

**Copiloto** — chat interno do corretor autenticado, ver seção 12.8.

**Documentos** — fila de `documents` pendentes de revisão, ações de aprovar/rejeitar com motivo.

**Formulários** — `form_submissions` pendentes/preenchidos/expirados — útil pra operação identificar cadastro parado no meio.

**Corretores** — roster + gestão de `broker_availability`/`broker_blocked_slots`.

**Resumos, Materiais, Canais, Atendimento, Agentes, Configurações** — reaproveitados sem alteração de shell.

*Sem equivalente neste domínio:* telas de vendas de infoproduto e recuperação de carrinho — `/pagamentos` cobre o espírito de "acompanhar recebíveis".

### 17.2 Sobre o diferencial "Integração com CRM"

O painel já cobre o essencial de um CRM leve pro escopo atual (funil, corretores, contratos, pagamentos). Webhook genérico de saída pra CRM externo fica de Marco 4.

### 17.3 Vitrine pública

`app/(public)/imoveis` — listagem e filtro dos imóveis com `status = 'disponivel'`, sem autenticação, pensada pra SEO/compartilhamento (alguém recebe um link de imóvel e abre direto, sem precisar estar no WhatsApp). É a peça mais barata deste PRD em relação ao valor que entrega pro critério de "Experiência do Usuário" — usa dado que já existe (`properties`), só precisa de camada de leitura pública.

---

## 18. Variáveis de Ambiente

```bash
# Supabase (projeto dedicado)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# OpenAI
OPENAI_API_KEY=

# Redis (Upstash)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Criptografia — AES-256-GCM (credenciais, CPF) + base pro HMAC de cpf_hash
APP_ENCRYPTION_KEY=   # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Cron
CRON_SECRET=

# Z-API / Meta (fallback — preferir /canais no admin)
ZAPI_INSTANCE= / ZAPI_TOKEN= / ZAPI_CLIENT_TOKEN=
META_WHATSAPP_PHONE_ID= / META_WHATSAPP_TOKEN= / META_APP_SECRET= / META_WEBHOOK_VERIFY_TOKEN=

# Asaas (Marco 3 — schema já existe, chamada real entra depois)
ASAAS_API_KEY=
ASAAS_WEBHOOK_TOKEN=
ASAAS_BASE_URL=https://sandbox.asaas.com/api/v3   # trocar pra produção

NEXT_PUBLIC_APP_URL=
```

Não há bloco de gateway de infoproduto. `GOOGLE_CALENDAR_*` sai da lista obrigatória (seção 7.4) e vira opcional de Marco 4. Não há bloco de assinatura eletrônica — a decisão da seção 15.3 (manual/gov.br) não exige nenhuma credencial de vendor.

---

## 19. Mapeamento — Critérios de Avaliação do Hackathon

| Critério (PDF) | Como o LoveHome atende | Onde neste PRD |
|---|---|---|
| **Arquitetura** — organização, escalabilidade, componentização | Pipeline unificado + agentes desacoplados via tool-calling + identidade em duas camadas (conversacional vs. formal) + RLS por linha pra escala multi-corretor | Seções 6, 7, 8, 9.3 |
| **IA** — qualidade das respostas, humanização, contexto conversacional | Histórico persistido injetado por chamada, busca híbrida de imóveis + comparáveis de mercado pra respostas concretas, checagem de identidade determinística (não deixada ao critério do LLM) | Seções 6.3, 11, 12 |
| **Experiência do Usuário** — interface, clareza, usabilidade | Painel completo (funil/contratos/pagamentos/documentos), fluxo de qualificação sem gate de cadastro prematuro, vitrine pública | Seções 6.3, 17 |
| **Inovação** — criatividade, diferenciais técnicos | Cadastro em duas camadas com hash+criptografia de CPF, workflow de aprovação humana, ciclo de vida completo de locação (não só captação), busca híbrida | Seções 6, 10.6, 14, 15 |

*Nota:* pro Marco 1 (entrega do hackathon), o mais importante é que os cenários 1–3 (seção 4) funcionem de ponta a ponta — os cenários 4–5 (proprietário/inquilino) e as seções 14/15 (Asaas/assinatura) demonstram profundidade de arquitetura e visão de produto no pitch, mesmo rodando com dados simulados na demonstração ao vivo.

---

## 20. Mapeamento — Entregáveis do Hackathon

| Entregável (PDF) | Onde nasce no LoveHome |
|---|---|
| Repositório do projeto | Novo repo `lovehome-ai` — estrutura da seção 8 |
| README | Visão do sistema: objetivo, arquitetura, funcionalidades e operação, com diagramas |
| Arquitetura da solução | Este PRD — seções 6, 7, 8, 10, 12 |
| Demonstração funcional | Cenários 1–3 (obrigatórios) ao vivo; 4–5 como demonstração adicional se o tempo permitir |
| Pitch técnico | Tabela da seção 19 + a narrativa de "marco 1 de um produto maior" (seção 1.2) como diferencial de visão estratégica |
| Explicação da IA utilizada | Seções 11 (RAG/busca híbrida) e 12 (multiagente, prompts, tools) |

---

## 21. Roadmap por Marcos

Estrutura por marco de produto, não por semana de calendário — ajustar prazos conforme a entrega real da turma, mas sem deixar o Marco 1 crescer além do que o hackathon avalia.

### Marco 1 — Entrega do hackathon

Tudo que é necessário pros cenários 1–3 (seção 4) funcionarem de ponta a ponta e pros critérios de avaliação (seção 19) serem atendidos:

- [ ] Projeto Supabase dedicado + migrations: identidade (`contacts`, `registrations`, `contact_roles`), imóveis, qualificação, visitas, corretores (+ `broker_availability`), resumos
- [ ] Pipeline com `resolveRegistration` determinístico (seção 6.3)
- [ ] Agentes SDR, Investidor, Agendamento, Despedida + gerador de resumo
- [ ] Busca híbrida de imóveis + seed de 50–150 imóveis simulados
- [ ] Formulário público de cadastro (`(public)/cadastro/[token]`)
- [ ] WhatsApp (Z-API no mínimo) + debounce + follow-up cron
- [ ] Painel: dashboard, imóveis, visitas, corretores, resumos, leads
- [ ] Vitrine pública básica (`(public)/imoveis`) — barata e de alto impacto visual pro pitch

### Marco 2 — Proprietário, venda, ciclo de contrato e Copiloto

- [ ] Agente Proprietário + `get_market_comparables`
- [ ] Formulário de listagem de imóvel + upload de fotos (form e via WhatsApp)
- [ ] `documents`, `approval_requests` — workflow de aprovação (UI simples: aprovar/rejeitar/pedir mais informação)
- [ ] Agente Closer revisado — `create_deal` cobrindo **venda e locação** (Exemplo 6)
- [ ] `deals` com ciclo completo de status, dados de pagamento simulados
- [ ] `contract_templates` (venda e locação) + geração de PDF preenchido
- [ ] Fluxo de assinatura manual/gov.br + recebimento do PDF assinado via WhatsApp (novo handler de mídia tipo `document`) — seção 15.3, sem depender de vendor
- [ ] Copiloto do Corretor (seção 12.8) + RLS de `properties`/`deals` por corretor
- [ ] Telas admin: proprietários, contratos (venda + locação), documentos, formulários

### Marco 3 — Pagamento recorrente ao vivo

- [ ] Integração real com Asaas (webhook + geração de cobrança + reconciliação)
- [ ] Agente Suporte completo (extrato real, status de contrato, rescisão validada)
- [ ] Tela admin de pagamentos com dado real
- [ ] Upload manual do PDF assinado devolvido por e-mail (seção 15.3) — avaliar automatizar se o volume justificar

### Marco 4 — Escala e polish

- [ ] Sync opcional com Google Calendar por corretor (upgrade de `broker_availability`)
- [ ] Formulário configurável (upgrade do formulário fixo)
- [ ] Webhook genérico de saída pra CRM externo
- [ ] TTS (Voice AI completo)
- [ ] Ingestão automática de e-mail (upgrade do upload manual de PDF assinado)
- [ ] Reavaliar vendor pago de assinatura eletrônica (ClickSign/D4Sign/Autentique) se fizer sentido rastrear/lembrar assinatura pendente automaticamente
- [ ] Copiloto do Corretor também via WhatsApp (número interno separado)

---

## 22. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Escopo do Marco 1 vaza pra funcionalidades de Marco 2+ sob pressão de "já que estamos fazendo mesmo" | Alta | Alto | Seção 21 é a fonte de verdade do que entra em cada marco — revisar antes de começar a construir algo fora da lista do Marco 1 |
| Base simulada de imóveis pouco realista/pequena demais | Média | Alto | Seed com 50–150 imóveis cobrindo as combinações dos cenários 1–3 |
| Orquestrador classifica intent errado (compra vs. investimento vs. disponibilizar) | Média | Alto | `routing_logs` + override manual no painel |
| Gate de cadastro cedo demais afasta lead na busca inicial | Média | Alto | Regra explícita da seção 6.3 — cadastro só em ações de consequência, nunca pra só conversar/buscar |
| CPF tratado sem cuidado (log, texto plano, exibição completa) | Baixa | Alto | Três colunas com papéis distintos (seção 6.2) — hash pra busca, criptografia reversível só server-side, últimos 4 dígitos pra UI |
| `search_properties`/`get_market_comparables` alucina fora do filtro estruturado | Baixa | Médio | Filtro estruturado sempre roda antes do reranking semântico — nunca o contrário |
| Corretor não recebe resumo (falha de envio WhatsApp) | Baixa | Médio | `lead_summaries` sempre grava no painel independente do canal de notificação |
| Fila de aprovação de documentos vira gargalo (ninguém revisa a tempo) | Média | Médio | Notificação no painel + contagem de pendentes visível no dashboard |
| Prazo do hackathon aperta mesmo com Marco 1 bem definido | Média | Alto | Cortar Proprietário/Closer/Suporte primeiro dentro do próprio Marco 1 se necessário — nenhum dos cenários 1–3 depende deles |
| Vendor de Asaas muda de plano ou API depois de integrado | Baixa | Médio | Isolado em `lib/asaas/` — troca de vendor não deveria tocar em agentes ou schema |
| Cliente esquece de devolver o PDF assinado (fluxo manual/gov.br não tem lembrete automático nativo) | Média | Médio | Reaproveitar o mesmo cron de follow-up (seção 13) pra lembrar quem está com `deal.status = 'em_aprovacao'` e contrato enviado há mais de X dias sem `signed_document_url` |
| Corretor esquece de conferir e-mail com PDF assinado, contrato fica parado (upload manual até o Marco 3) | Média | Médio | Contagem de negócios aguardando assinatura visível no dashboard, ao lado da fila de documentos pendentes |
| Z-API/Meta instável durante a demonstração | Baixa | Alto | Ensaiar com fallback em modo texto direto, sem depender do WhatsApp ao vivo |

---

## 23. Referências Internas

- Enunciado do desafio: `POSTECH - Hacka Agente_SDR_Imobiliario - Fase 5.pdf` (Tech Challenge FIAP, Fase 5)
- Projeto Supabase: dedicado ao LoveHome
- Nome do repositório: `lovehome-ai`

---

*Este documento é o ponto de partida do repositório `lovehome-ai`. Deve ser atualizado a cada decisão técnica relevante — em especial se o time decidir mudar o corte entre marcos, ou quando o vendor de assinatura eletrônica for escolhido.*
