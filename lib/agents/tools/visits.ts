// ==========================================
// Tools de agendamento — check_broker_availability e create_visit.
//
// A agenda e a tabela interna broker_availability/broker_blocked_slots, nao o
// Google Calendar de cada corretor (PRD 7.4): OAuth por corretor expira, e
// revogado e quebra numa demonstracao ao vivo.
//
// create_visit exige registration_status = 'completo' — o bloqueio nao esta
// aqui, e centralizado em TOOLS_QUE_EXIGEM_CADASTRO e aplicado pelo base-agent.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import type OpenAI from 'openai'

type Tool = OpenAI.ChatCompletionTool

/** Duracao padrao de uma visita, usada para detectar conflito de horario. */
const DURACAO_VISITA_MIN = 60

export const checkBrokerAvailabilityTool: Tool = {
  type: 'function',
  function: {
    name: 'check_broker_availability',
    description: `Lista horários livres para visita nos próximos dias. Chame ANTES de propor
qualquer horário — nunca invente disponibilidade. Se a pessoa sugerir um horário,
confira aqui antes de confirmar.`,
    parameters: {
      type: 'object',
      properties: {
        property_reference: {
          type: 'string',
          description: 'Código do imóvel (ex: LH-1001) — define qual corretor atende',
        },
        dias_a_frente: {
          type: 'number',
          description: 'Quantos dias à frente considerar (padrão 7)',
        },
      },
      required: ['property_reference'],
    },
  },
}

export const createVisitTool: Tool = {
  type: 'function',
  function: {
    name: 'create_visit',
    description: `Agenda a visita depois que a pessoa escolheu um horário que você confirmou
como livre. Exige cadastro completo — se não houver, chame request_registration_form antes.`,
    parameters: {
      type: 'object',
      properties: {
        property_reference: { type: 'string', description: 'Código do imóvel' },
        scheduled_at: {
          type: 'string',
          description: 'Data e hora no formato ISO 8601 com fuso, ex: 2026-08-20T14:00:00-03:00',
        },
        type: {
          type: 'string',
          enum: ['visita', 'reuniao_investidor', 'call_apresentacao'],
          description: 'Tipo do compromisso (padrão: visita)',
        },
      },
      required: ['property_reference', 'scheduled_at'],
    },
  },
}

async function acharImovel(referencia: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('properties')
    .select('id, reference_code, title, region, broker_id, status')
    .ilike('reference_code', referencia.trim())
    .maybeSingle()
  return data
}

export async function handleCheckBrokerAvailability(params: {
  property_reference: string
  dias_a_frente?: number
}) {
  const supabase = createAdminClient()
  const imovel = await acharImovel(params.property_reference)

  if (!imovel) return { erro: `Imóvel ${params.property_reference} não encontrado.` }
  if (!imovel.broker_id) return { erro: 'Esse imóvel ainda não tem corretor responsável.' }

  const dias = params.dias_a_frente ?? 7
  const agora = new Date()
  const limite = new Date(agora.getTime() + dias * 24 * 60 * 60 * 1000)

  const [{ data: janelas }, { data: bloqueios }, { data: visitas }, { data: corretor }] =
    await Promise.all([
      supabase.from('broker_availability').select('weekday, start_time, end_time').eq('broker_id', imovel.broker_id),
      supabase
        .from('broker_blocked_slots')
        .select('starts_at, ends_at')
        .eq('broker_id', imovel.broker_id)
        .lte('starts_at', limite.toISOString())
        .gte('ends_at', agora.toISOString()),
      supabase
        .from('property_visits')
        .select('scheduled_at')
        .eq('broker_id', imovel.broker_id)
        .in('status', ['agendada', 'confirmada'])
        .gte('scheduled_at', agora.toISOString())
        .lte('scheduled_at', limite.toISOString()),
      supabase.from('brokers').select('name').eq('id', imovel.broker_id).maybeSingle(),
    ])

  if (!janelas || janelas.length === 0) {
    return { erro: 'O corretor responsável não tem agenda cadastrada.' }
  }

  const ocupados = (visitas ?? []).map((v) => new Date(v.scheduled_at).getTime())
  const livres: string[] = []

  for (let d = 0; d < dias && livres.length < 12; d++) {
    const dia = new Date(agora)
    dia.setDate(dia.getDate() + d)
    const janelasDoDia = janelas.filter((j) => j.weekday === dia.getDay())

    for (const janela of janelasDoDia) {
      const [hIni] = janela.start_time.split(':').map(Number)
      const [hFim] = janela.end_time.split(':').map(Number)

      for (let h = hIni; h < hFim; h++) {
        const slot = new Date(dia)
        slot.setHours(h, 0, 0, 0)

        // Passado não conta, e nada de propor daqui a 30 minutos.
        if (slot.getTime() < agora.getTime() + 2 * 60 * 60 * 1000) continue

        const conflitaVisita = ocupados.some(
          (t) => Math.abs(t - slot.getTime()) < DURACAO_VISITA_MIN * 60 * 1000
        )
        if (conflitaVisita) continue

        const conflitaBloqueio = (bloqueios ?? []).some(
          (b) =>
            slot.getTime() >= new Date(b.starts_at).getTime() &&
            slot.getTime() < new Date(b.ends_at).getTime()
        )
        if (conflitaBloqueio) continue

        livres.push(slot.toISOString())
        if (livres.length >= 12) break
      }
      if (livres.length >= 12) break
    }
  }

  return {
    imovel: `${imovel.reference_code} — ${imovel.title}`,
    corretor: corretor?.name ?? null,
    horarios_livres: livres,
    instrucao:
      'Ofereça no máximo 3 opções por mensagem, em linguagem natural ("quinta às 10h" e não a data ISO).',
  }
}

export async function handleCreateVisit(
  contactId: string,
  params: { property_reference: string; scheduled_at: string; type?: string }
) {
  const supabase = createAdminClient()
  const imovel = await acharImovel(params.property_reference)

  if (!imovel) return { agendado: false, erro: `Imóvel ${params.property_reference} não encontrado.` }
  if (!imovel.broker_id) return { agendado: false, erro: 'Imóvel sem corretor responsável.' }

  const quando = new Date(params.scheduled_at)
  if (Number.isNaN(quando.getTime())) {
    return { agendado: false, erro: 'Data inválida. Use ISO 8601 com fuso.' }
  }
  if (quando.getTime() < Date.now()) {
    return { agendado: false, erro: 'Esse horário já passou. Ofereça outro.' }
  }

  /* Recheca conflito no momento de gravar. Entre o check_broker_availability e
     esta chamada passaram-se turnos de conversa, e outro lead pode ter ocupado
     o horario nesse meio-tempo. */
  const inicio = new Date(quando.getTime() - DURACAO_VISITA_MIN * 60 * 1000).toISOString()
  const fim = new Date(quando.getTime() + DURACAO_VISITA_MIN * 60 * 1000).toISOString()

  const { data: conflito } = await supabase
    .from('property_visits')
    .select('id')
    .eq('broker_id', imovel.broker_id)
    .in('status', ['agendada', 'confirmada'])
    .gt('scheduled_at', inicio)
    .lt('scheduled_at', fim)
    .limit(1)
    .maybeSingle()

  if (conflito) {
    return {
      agendado: false,
      erro: 'Esse horário acabou de ser ocupado. Chame check_broker_availability e ofereça outro.',
    }
  }

  const { data: visita, error } = await supabase
    .from('property_visits')
    .insert({
      contact_id: contactId,
      property_id: imovel.id,
      broker_id: imovel.broker_id,
      scheduled_at: quando.toISOString(),
      type: params.type ?? 'visita',
      status: 'agendada',
    })
    .select('id')
    .single()

  if (error) return { agendado: false, erro: error.message }

  await supabase
    .from('contacts')
    .update({
      funnel_stage: 'visita_agendada',
      assigned_broker_id: imovel.broker_id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId)

  return {
    agendado: true,
    visita_id: visita.id,
    imovel: `${imovel.reference_code} — ${imovel.title}`,
    quando: quando.toISOString(),
  }
}
