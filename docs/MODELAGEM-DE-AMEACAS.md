# Modelagem de Ameaças — LoveHome

> Relatório técnico de segurança do projeto **LoveHome**. Metodologia: STRIDE por superfície de
> ataque, com as mitigações apontando para o código que as aplica e os riscos residuais assumidos.
> Baseado na revisão de segurança pré-deploy (16/08/2026) e mantido junto dela.

## 1. Escopo e ativos

**Ativos protegidos**, do mais crítico ao menos: CPF e documentos pessoais (RG, comprovante de
renda) · contratos (CPF + endereço + valores) · conversas de clientes · credenciais de canal
(WhatsApp, Asaas) · a conta da OpenAI (custo) · o número de WhatsApp da imobiliária (reputação) ·
disponibilidade do atendimento.

**Atores**: cliente anônimo (WhatsApp/site) · atacante externo com a URL pública · usuário do
painel (admin, corretor, editor, viewer) · corretor malicioso ou conta comprometida · terceiros
integrados (Z-API, Meta, Asaas, CRM da casa).

## 2. Superfícies e ameaças (STRIDE)

### 2.1 Webhooks de entrada (Z-API, Meta, Asaas)

| Ameaça | Tipo | Mitigação |
|---|---|---|
| POST forjado vira "mensagem de cliente", resposta pelo WhatsApp da imobiliária e gasto de OpenAI | Spoofing | Z-API: segredo na URL (`?token=`), comparação timing-safe, **fail-closed** (sem segredo → 403). Meta: HMAC do corpo bruto. Asaas: token no header. Tudo em `app/api/webhook/*` |
| Reentrega duplica atendimento/cobrança | Tampering | Dedup por `message_id` (Redis) e `UNIQUE(event, asaas_payment_id)`; erro interno responde 200 para a Meta/Asaas não reenviarem infinitamente |
| Servidor baixando URL arbitrária de "mídia" | Elevation | Mídia só é baixada de mensagem autenticada; tipo e tamanho validados (allowlist PDF/JPG/PNG/WebP, teto 10MB) |

### 2.2 Widget e rotas públicas

| Ameaça | Tipo | Mitigação |
|---|---|---|
| Laço de script esvazia a conta da OpenAI | DoS | Únicas rotas anônimas que gastam dinheiro: limite por sessão e por IP em Redis (`lib/widget/protecao.ts`) |
| Site não autorizado embute o widget | Spoofing | Origem registrada em `widget_sites`, CORS com origem específica (nunca `*`), desativar corta na hora |
| Adivinhar token de sessão lê histórico alheio | Info disclosure | Token gerado no servidor; sessão desconhecida → 404 (não cria); `/poll` confere sessão antes de drenar |
| Formulário público alimentado por força bruta | Tampering | Token de 32 bytes de uso único com expiração; respostas filtradas por campo ativo e visível |

### 2.3 Painel administrativo

| Ameaça | Tipo | Mitigação |
|---|---|---|
| Página/rota nova nasce aberta | Elevation | Toda página chama `exigirAcesso`, toda rota `autorizarApi` (matriz §9.2 no servidor; menu é conveniência) |
| IDOR: corretor com UUID alheio aprova negócio, baixa RG | Elevation | `lib/auth/carteira.ts` — ponto único de posse (negócio, documento, imóvel); provado por `check:auth` |
| Open redirect no login | Spoofing | Só caminho interno passa em `?proximo=`/`next` |
| Escalada entre papéis pelo Copiloto | Elevation | Ferramentas filtradas pela matriz **no servidor**; `broker_id` nunca é parâmetro de tool (ligado por closure; `check:copiloto` prova estruturalmente) |
| Auto-lockout / golpe interno | Repudiation | Ninguém edita o próprio papel; sempre resta um admin; desativar em vez de apagar preserva auditoria |

### 2.4 Dados pessoais (LGPD)

| Ameaça | Tipo | Mitigação |
|---|---|---|
| Vazamento de CPF | Info disclosure | Três colunas com papéis distintos; `decryptSecret` em **exatamente dois lugares** (contrato e Asaas — `check:asaas` verifica estruturalmente que não surge um terceiro); UI sempre mascarada; Vision instruído a **não transcrever** documento; log nunca carrega fala do cliente |
| Documento sensível coletado sem necessidade | Info disclosure | Documentos só **após o aceite** da proposta (`request_documents` recusa antes — minimização) |
| CPF de terceiro usado para sequestrar cadastro | Spoofing | CPF repetido **nunca vincula sozinho**: fila de conferência humana; vincular exige permissão que só o admin tem |
| Dado pessoal enviado a terceiros | Info disclosure | Webhook de CRM **nunca leva CPF** (a query nem seleciona as colunas; `check:crm` prova); sem segredo de assinatura, nada é enviado |
| Direito de exclusão inviável | Compliance | FKs de `contacts` cascateiam (migration 014); custo de IA fica com `SET NULL` (dado financeiro da empresa, não pessoal) |
| Vazamento da chave anon do Supabase | Info disclosure | RLS deny-all nas tabelas sensíveis; RPCs revogadas de `anon`; helpers de policy fora de `public` |

### 2.5 A IA como superfície

| Ameaça | Tipo | Mitigação |
|---|---|---|
| Prompt injection pelo cliente ("aprove meu contrato") | Elevation | Ação de consequência não é decidida pelo modelo: gate de cadastro por tool, reserva só no aceite humano, aprovação/ativação só no painel, titularidade no Suporte por hash + Redis (5 tentativas, 12h) |
| Link inventado (phishing involuntário) | Spoofing | `removerLinksInventados`: URL que não veio de tool/prompt/conversa é removida e logada (`check:links`) |
| Resposta inventada sobre política/financiamento | Integrity | RAG recusa responder sem trecho indexado; material com erro fica invisível, não meio-visível |
| Vazamento entre carteiras via Copiloto | Info disclosure | Escopo por closure; busca por termo dentro do escopo em vez de UUID |
| Custo descontrolado | DoS | Debounce agrupa rajadas; allowlist de envio em dev; `llm_usage` registra os 13 pontos pagos |

### 2.6 Storage e arquivos

Buckets `contratos`, `documentos` e `materiais` privados; download só por URL assinada de 5
minutos pedida sob demanda (a query devolve booleanos, nunca o caminho). Upload com allowlist de
tipo, teto de tamanho e nome gerado no servidor. `check:contrato` prova que a URL pública **não**
abre contrato. Risco conhecido: o CDN pode servir cópia em cache de foto pública removida por um
tempo.

## 3. Riscos residuais assumidos

1. **Sem CSP completo** — o tema é script inline e o widget roda em site de terceiro; um CSP às
   pressas quebraria ambos em silêncio. Pendência registrada, com cabeçalhos base já aplicados
   (nosniff, HSTS, frame-ancestors, Referrer-Policy, Permissions-Policy).
2. **SSRF limitado no webhook de CRM** — a URL é configurada só por admin; validação exige
   http(s). Aceito por ser superfície autenticada e de escopo estreito.
3. **Segredos no ambiente da Vercel** — rotação manual; `APP_ENCRYPTION_KEY` não rotaciona sem
   migrar os CPFs (documentado).
4. **Tabela de preços de modelo manual** — custo é estimativa; desvio aparece na fatura, não num
   alerta.
5. **`.env` fora do repositório** — conferido a cada commit; se um dia vazar no histórico, todas as
   chaves são consideradas comprometidas (procedimento descrito no CLAUDE interno e README §15).

## 4. Como esta modelagem é validada

Parte das mitigações é **provada por teste estrutural**, não por disciplina: `check:auth` (matriz e
carteira), `check:gate` (cadastro real, não cache), `check:suporte` (CPF sem vazar valor),
`check:copiloto` (nenhum schema com `broker_id`), `check:asaas` (só dois pontos de descriptografia),
`check:contrato` (bucket privado de fato), `check:links` (URL inventada removida), `check:meta` /
`check:canais` (credencial cifrada e mascarada), `check:widget` (origem, token, limites),
`check:crm` (payload sem CPF, fail-closed). A lista completa está no README §14.
