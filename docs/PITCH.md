# Pitch Técnico — Roteiro (LoveHome)

> Roteiro de apresentação do Tech Challenge Fase 5. Alvo: **8 minutos** de fala + demo ao vivo,
> com a versão de 5 minutos indicada nos cortes. Quem apresenta lê a coluna "fala"; a coluna
> "mostrar" é o que está na tela naquele momento.

## Antes de subir ao palco (checklist)

- [ ] Celular carregado, **espelhado no telão**, conversa do WhatsApp da LoveHome aberta e limpa
- [ ] Contato de demo **com cadastro completo** (para a proposta não esbarrar no formulário ao vivo)
- [ ] Painel logado em três abas: `/admin/contratos` (fila de propostas), `/admin/conversas`, `/admin/uso`
- [ ] Vitrine aberta em `/imoveis` (mostrar que o imóvel da demo está **disponível**)
- [ ] Nenhuma proposta pendente do contato de demo no imóvel da demo (senão o `create_deal` devolve a existente)
- [ ] **Plano B gravado**: vídeo de 90s com o mesmo fluxo, para o caso de rede/webhook falhar no palco
- [ ] Diagramas abertos: fluxo de mensagem (README §4) e contexto (docs/ARQUITETURA.md §1)

## Roteiro

| ⏱ | Bloco | Fala (essência) | Mostrar |
|---|---|---|---|
| 0:00–0:40 | **Problema** | "Imobiliária perde lead por demora e falta de acompanhamento: o corretor não responde às 23h, não faz follow-up de 40 conversas e não prioriza quem está quente. O edital pede um SDR de IA; nós fomos além — construímos a operação inteira." | Slide-título com uma frase: *"O modelo conversa. O código garante."* |
| 0:40–1:10 | **A solução em 30s** | "LoveHome: agentes de IA atendem WhatsApp e site, qualificam, agendam visita com agenda real de corretor, conduzem proposta, documentos, contrato e cobrança — e um painel dá o controle à equipe humana. Está **em produção na Vercel agora**, e é isso que vou mostrar." | Vitrine pública + painel lado a lado |
| 1:10–4:10 | **DEMO AO VIVO** | Narrar enquanto acontece (abaixo) | Celular espelhado + painel |
| 4:10–5:30 | **Arquitetura** | "Três canais entram num pipeline único: dedup, debounce que junta rajadas, gate determinístico de cadastro, e um Orquestrador que roteia **a cada mensagem** — trocar de assunto troca de agente sem perder o fio, porque além da memória por agente todo agente recebe a conversa completa. A tese do projeto: **ação de consequência nunca depende de o modelo lembrar** — link só sai se veio de ferramenta (URL inventada é removida), reservar imóvel é aceite humano no painel, CPF é confirmado por hash antes de qualquer extrato." | Diagrama do fluxo de mensagem |
| 5:30–6:30 | **A IA por dentro** | "Tool calling nativo da OpenAI, sem LangChain — menos camadas e trace completo nosso. Modelos por função: agentes em gpt-4o; roteador em gpt-4o-mini (~US$ 0,0001 por mensagem); embeddings na busca híbrida — o filtro estruturado define o conjunto, a semântica **só reordena**, então o agente nunca oferece imóvel fora do orçamento; Whisper transcreve áudio (voz na entrada, resposta em texto por decisão); RAG institucional com limiar **medido** (0,35) que se recusa a responder sem material — em financiamento, regra inventada custa caro." | Tela de Agentes (fluxo) → trace de uma resposta |
| 6:30–7:15 | **Engenharia e segurança** | "40 migrations versionadas; 30+ scripts de verificação contra o banco real como rede de regressão — do gate de cadastro à ordem da fila de propostas. Segurança documentada em relatório próprio de modelagem de ameaças: CPF em três colunas (hash pra buscar, cifrado pra contrato e cobrança, últimos 4 pra tela), webhooks fail-closed, IDOR de carteira testado, e o webhook de CRM que **assina tudo e nunca envia CPF**." | docs/MODELAGEM-DE-AMEACAS.md + tela Uso e custo |
| 7:15–8:00 | **Fechamento** | "O edital pediu um SDR; entregamos um funil que termina em contrato assinado pelo WhatsApp e cobrança recorrente — com custo por conversa medido em centavos e auditável chamada a chamada. É software que poderia estar operando numa imobiliária amanhã. Obrigado." | Placar da validação (34 itens atendidos) |

## Demo ao vivo (3 min, narrada)

1. **Áudio no WhatsApp** *(0:30)* — mandar voz: *"Oi! Tô procurando um apê de dois quartos na Vila
   Mariana, até uns oitocentos mil."* → resposta em **texto** com imóveis reais e link.
   Narrar: "áudio virou texto com Whisper; os imóveis vêm do banco, e o link vem da ferramenta —
   o modelo é proibido de inventar URL."
2. **Proposta** *(0:40)* — digitar: *"Quero fazer uma proposta de 750 mil no LH-1001."* → "proposta
   registrada, levo ao proprietário". Mostrar a vitrine: **o imóvel continua disponível**.
   Narrar: "proposta baixa não esconde o imóvel de quem pagaria o anunciado — é uma fila."
3. **Aceite no painel** *(0:50)* — em `/admin/contratos`, o cartão com "avaliar primeiro";
   clicar **Aceitar proposta** → no telão, o WhatsApp recebe na hora o aviso com a lista de
   documentos. Narrar: "o aceite é humano; é ele que reserva o imóvel e abre a coleta."
4. **Bastidores** *(1:00)* — `/admin/conversas`: abrir o **trace** da resposta (agente escolhido e
   por quê, cada tool com argumento e retorno) → `/admin/uso`: o custo daquela conversa, entrada e
   saída separadas. Narrar: "cada resposta é auditável; cada centavo tem dono."

**Se a rede falhar:** seguir o roteiro narrando sobre o vídeo gravado — a fala não muda.

## Versão de 5 minutos (o que cortar)

Bloco de engenharia (7:15 vira 30s dentro do fechamento) · passo 4 da demo vira um print único do
trace · arquitetura sem o diagrama de contexto, só o fluxo de mensagem.

## Divisão sugerida (grupo)

1 pessoa no problema+solução · 1 na demo (quem mais treinou) · 1 em arquitetura+IA ·
1 em engenharia+fechamento. Quem não está falando cuida do telão e do celular.

## Perguntas prováveis (e a resposta curta)

- **"E se o modelo alucinar preço ou link?"** — Preço vem do banco pela tool; URL que não veio de
  ferramenta é removida da resposta e logada (`check:links` prova). No RAG, sem trecho indexado o
  agente não responde de memória.
- **"Quanto custa por conversa?"** — Roteador ~US$ 0,0001/mensagem; conversa típica sai por
  centavos. Tudo registrado em `llm_usage`, com o painel mostrando o porquê de cada custo.
- **"Como escala?"** — Serverless stateless na Vercel; estado efêmero no Redis (dedup, debounce,
  limites), durável no Postgres. Nada mora na instância.
- **"Por que sem LangChain?"** — Tool calling nativo dá menos camadas, payload por modelo
  controlado (`montarParametros`) e trace completo — o framework esconderia justamente o que
  queremos auditar.
- **"E a LGPD?"** — Minimização de verdade: documentos só depois do aceite; CPF descriptografado em
  exatamente dois lugares (contrato e cobrança — teste estrutural garante); webhook de CRM nunca
  leva CPF; relatório de ameaças no repositório.
- **"O que falta para produção comercial?"** — CSP completo, TTS, ingestão de e-mail e vendor de
  assinatura — roteiro consciente, registrado no README, nada bloqueante para operar.
