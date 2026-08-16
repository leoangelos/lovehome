// ==========================================
// Follow-up automático (PRD 13.3, Exemplo 3).
//
// Reengaja quem parou de responder, usando o histórico real do agente que estava
// atendendo — a diferença entre "oi, ainda tem interesse?" e "vi que você
// buscava apê na Vila Mariana até R$ 800 mil, separei mais duas opções".
//
// Três travas, porque a fronteira entre lembrar e importunar é estreita:
//   * limite de tentativas por contato
//   * horário civilizado (ninguém recebe oferta de imóvel às 3h)
//   * silêncio total se um humano assumiu a conversa
// ==========================================

import { openai } from '@/lib/openai/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchOutgoing } from '@/lib/channels'
import { brl } from '@/lib/utils/format'
import type { ChatHistoryMessage } from '@/lib/types/agents'
import type { Channel } from '@/lib/channels/types'
import { registrarUso } from '@/lib/observabilidade/uso'
import { getConfiguracoes } from '@/lib/config/app'

/* Estes valores vinham fixos aqui e agora saem de `app_settings` (tela de
   Configurações). O que era comentário virou campo: o silêncio antes de cada
   tentativa, a janela em horário de Brasília e o teto por execução. */

const PROMPT = `Você escreve UMA mensagem curta de WhatsApp para retomar contato com alguém
que parou de responder a uma imobiliária.

Regras:
- No máximo 2 frases. Escreva como pessoa digitando no celular, não como campanha.
- Retome algo CONCRETO da conversa (bairro, faixa de preço, tipo de imóvel). Se você não tem
  esse dado, escreva algo curto e honesto, sem inventar preferência que a pessoa não disse.
- Sem "espero que esteja bem", sem "passando para lembrar", sem emoji em excesso (no máximo um).
- Termine com uma pergunta simples e fácil de responder.
- Não peça cadastro, não mande link, não prometa desconto.
- Não repita o que já foi dito na última mensagem sua que aparece no histórico.`

export interface ResultadoFollowup {
  avaliados: number
  enviados: number
  pulados: { motivo: string; contato: string }[]
  foraDeHorario: boolean
}

function horaEmBrasilia(): number {
  return Number(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: 'numeric',
      hour12: false,
    }).format(new Date())
  )
}

export async function rodarFollowups(): Promise<ResultadoFollowup> {
  const supabase = createAdminClient()
  const pulados: { motivo: string; contato: string }[] = []

  const config = await getConfiguracoes()
  const HORAS_ATE_TENTATIVA = config.followup_horas
  const MAX_TENTATIVAS = HORAS_ATE_TENTATIVA.length
  const MAX_POR_EXECUCAO = config.followup_max_por_execucao

  /* Desligar o follow-up pela tela precisa parar o cron de verdade — deixar o
     cron rodar e só não enviar gastaria consulta e daria log confuso. */
  if (!config.followup_ativo) {
    console.log('[followup] desligado nas Configurações — nada enviado')
    return { avaliados: 0, enviados: 0, pulados: [], foraDeHorario: true }
  }

  const hora = horaEmBrasilia()
  if (hora < config.followup_hora_inicio || hora >= config.followup_hora_fim) {
    console.log(`[followup] fora da janela (${hora}h em Brasília) — nada enviado`)
    return { avaliados: 0, enviados: 0, pulados: [], foraDeHorario: true }
  }

  const limiteMaisRecente = new Date(
    Date.now() - HORAS_ATE_TENTATIVA[0] * 60 * 60 * 1000
  ).toISOString()

  const { data: candidatos, error } = await supabase
    .from('contacts')
    .select('id, name, phone, channel_default, funnel_stage, intent, active_agent, last_contact, followup_count')
    .eq('blocked', false)
    .not('funnel_stage', 'in', '("convertido","perdido")')
    .lt('followup_count', MAX_TENTATIVAS)
    .lt('last_contact', limiteMaisRecente)
    .order('last_contact', { ascending: true })
    .limit(MAX_POR_EXECUCAO * 3)

  if (error) throw new Error(`Falha ao buscar candidatos: ${error.message}`)

  let enviados = 0

  for (const contato of candidatos ?? []) {
    if (enviados >= MAX_POR_EXECUCAO) break

    const rotulo = contato.name ?? contato.id

    // A janela cresce a cada tentativa: 24h para a primeira, 72h para a segunda.
    const horasNecessarias = HORAS_ATE_TENTATIVA[contato.followup_count]
    const horasParado = (Date.now() - new Date(contato.last_contact!).getTime()) / 36e5
    if (horasParado < horasNecessarias) {
      pulados.push({ motivo: `só ${Math.floor(horasParado)}h de silêncio`, contato: rotulo })
      continue
    }

    if (!contato.phone) {
      pulados.push({ motivo: 'sem telefone (widget)', contato: rotulo })
      continue
    }

    /* Se um humano assumiu, o bot não fala. Vale também para 'escalated':
       ninguém pegou ainda, mas a conversa já foi entregue ao time. */
    const { data: conversa } = await supabase
      .from('conversations')
      .select('id, status, human_takeover')
      .eq('contact_id', contato.id)
      .eq('channel', contato.channel_default)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!conversa) {
      pulados.push({ motivo: 'sem conversa aberta', contato: rotulo })
      continue
    }
    if (conversa.human_takeover || conversa.status === 'escalated') {
      pulados.push({ motivo: 'humano no controle', contato: rotulo })
      continue
    }

    const texto = await montarMensagem(contato.id, contato.active_agent, contato.name)
    if (!texto) {
      pulados.push({ motivo: 'sem contexto para retomar', contato: rotulo })
      continue
    }

    try {
      await dispatchOutgoing(contato.channel_default as Channel, {
        contactId: contato.id,
        externalId: contato.phone,
        text: texto,
        displayName: null,
      })
    } catch (e) {
      /* Falha de envio não pode consumir a tentativa: senão um canal fora do ar
         gastaria as duas chances da pessoa sem que ela recebesse nada. */
      console.error(`[followup] envio falhou para ${rotulo}:`, (e as Error).message)
      pulados.push({ motivo: 'falha no envio', contato: rotulo })
      continue
    }

    await supabase.from('messages').insert({
      conversation_id: conversa.id,
      contact_id: contato.id,
      role: 'assistant',
      content: texto,
      media_type: 'text',
      channel: contato.channel_default,
      agent: 'followup',
    })

    /* last_contact NÃO é atualizado de propósito: ele marca o último sinal DA
       PESSOA. Mexer nele aqui reiniciaria o relógio de inatividade e o segundo
       follow-up nunca chegaria. Quem controla a cadência é followup_count. */
    await supabase
      .from('contacts')
      .update({
        followup_count: contato.followup_count + 1,
        last_followup_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', contato.id)

    enviados++
    console.log(`[followup] enviado para ${rotulo} (tentativa ${contato.followup_count + 1})`)
  }

  return { avaliados: candidatos?.length ?? 0, enviados, pulados, foraDeHorario: false }
}

/** Monta a mensagem a partir do histórico real do agente que atendia. */
async function montarMensagem(
  contactId: string,
  activeAgent: string | null,
  nome: string | null
): Promise<string | null> {
  const supabase = createAdminClient()

  const [{ data: historicos }, { data: qual }] = await Promise.all([
    supabase
      .from('agent_histories')
      .select('agent, messages')
      .eq('contact_id', contactId)
      .order('updated_at', { ascending: false })
      .limit(1),
    supabase
      .from('lead_qualifications')
      .select('intent, region, property_type, bedrooms, price_max_cents')
      .eq('contact_id', contactId)
      .maybeSingle(),
  ])

  const historico = historicos?.[0]
  const turnos = ((historico?.messages as ChatHistoryMessage[]) ?? []).slice(-8)

  /* Sem histórico nem qualificação não há o que retomar, e uma mensagem
     genérica ("ainda tem interesse?") é pior do que silêncio — parece
     disparo automático, que é exatamente o que estamos tentando não ser. */
  if (turnos.length === 0 && !qual?.region && !qual?.price_max_cents) return null

  const contexto = [
    nome ? `Nome: ${nome}` : null,
    activeAgent ? `Último agente: ${activeAgent}` : null,
    qual?.intent ? `Intenção: ${qual.intent}` : null,
    qual?.region ? `Região: ${qual.region}` : null,
    qual?.property_type ? `Tipo: ${qual.property_type}` : null,
    qual?.bedrooms ? `Dormitórios: ${qual.bedrooms}` : null,
    qual?.price_max_cents ? `Orçamento até: ${brl(qual.price_max_cents)}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const conversa = turnos
    .map((m) => `${m.role === 'user' ? 'Cliente' : 'Você'}: ${m.content}`)
    .join('\n')

  const resposta = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: `Contexto:\n${contexto}\n\nÚltimos turnos:\n${conversa}` },
    ],
  })

  await registrarUso({
    operacao: 'followup',
    modelo: 'gpt-4o-mini',
    tokensEntrada: resposta.usage?.prompt_tokens,
    tokensSaida: resposta.usage?.completion_tokens,
    detalhe: {
      resumo: 'Escreveu a mensagem de retomada do follow-up',
      entradas: [
        { rotulo: 'Últimos turnos usados', valor: String(turnos.length) },
        { rotulo: 'Contexto', valor: `${contexto.length} caracteres` },
      ],
    },
  })

  return resposta.choices[0].message.content?.trim() || null
}
