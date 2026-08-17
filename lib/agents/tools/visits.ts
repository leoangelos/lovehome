// ==========================================
// Tools de agendamento — check_broker_availability e create_visit.
//
// A agenda e a tabela interna broker_availability/broker_blocked_slots, nao o
// Google Calendar de cada corretor (PRD 7.4): OAuth por corretor expira, e
// revogado e quebra numa demonstracao ao vivo.
//
// create_visit exige registration_status = 'completo' — o bloqueio nao esta
// aqui, e centralizado em TOOLS_QUE_EXIGEM_CADASTRO e aplicado pelo base-agent.
//
// QUEM ATENDE: qualquer corretor ativo elegivel para o imovel (o responsavel
// ou quem atende o bairro — lib/agenda/equipe). Os horarios oferecidos sao a
// uniao das agendas; o corretor e escolhido na confirmacao e informado ao
// cliente com telefone/e-mail. Choque de horario e impossivel por construcao:
// o mesmo criterio de "livre" na consulta e na confirmacao, e um indice unico
// no banco (migration 035) para o caso de duas confirmacoes simultaneas.
//
// HORARIO E SEMPRE DE SAO PAULO. O servidor roda em UTC; a agenda do corretor
// ("09:00-18:00") e o que a pessoa fala ("quinta as 10h") sao relogio de SP.
// A consulta devolve cada horario ja como ISO com fuso (-03:00) E com rotulo
// em portugues, e a confirmacao usa exatamente o mesmo criterio de "livre" que
// a consulta (lib/agenda/slots). Antes eram dois calculos — a consulta em UTC,
// a confirmacao em -03:00 — e o agente ficava em loop: "esta livre" →
// "acabou de ser ocupado" → "esta livre".
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import {
  agoraDescrito,
  interpretarDataHora,
  isoComFuso,
  rotuloHorario,
} from '@/lib/agenda/fuso'
import { DURACAO_VISITA_MIN, escolherCorretor, gerarSlotsEquipe } from '@/lib/agenda/slots'
import { carregarEquipeParaImovel, type CorretorDaEquipe } from '@/lib/agenda/equipe'
import type OpenAI from 'openai'

type Tool = OpenAI.ChatCompletionTool

export const checkBrokerAvailabilityTool: Tool = {
  type: 'function',
  function: {
    name: 'check_broker_availability',
    description: `Lista horários livres para visita nos próximos dias, já em horário de São Paulo,
cada um com um rótulo em português ("quinta-feira 20/08 às 10h") e o valor exato para usar
em create_visit. Chame ANTES de propor qualquer horário — nunca invente disponibilidade.
Se a pessoa sugerir um horário, confira aqui antes de confirmar.`,
    parameters: {
      type: 'object',
      properties: {
        property_reference: {
          type: 'string',
          description: 'Código do imóvel (ex: LH-1001) — define a equipe de corretores que pode atender',
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
          description:
            'Use EXATAMENTE o campo `quando` de um horário devolvido por check_broker_availability (ISO 8601 com fuso, ex: 2026-08-20T14:00:00-03:00). Horário sem fuso é lido como horário de São Paulo.',
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

/** Formato que vai para o modelo: o instante exato + o que ele deve dizer. */
function descreverHorarios(slots: Date[]) {
  return slots.map((s) => ({ quando: isoComFuso(s), descricao: rotuloHorario(s) }))
}

function contatoDoCorretor(c: CorretorDaEquipe) {
  return { nome: c.nome, telefone: c.telefone, email: c.email }
}

const INSTRUCAO_HORARIOS =
  'Ofereça no máximo 3 opções por mensagem, usando o texto de `descricao` ("quinta-feira 20/08 às 10h"), nunca a data ISO. Não diga ainda qual corretor vai atender — isso é definido na confirmação. Para agendar, passe em create_visit o campo `quando` exatamente como está aqui.'

export async function handleCheckBrokerAvailability(params: {
  property_reference: string
  dias_a_frente?: number
}) {
  const imovel = await acharImovel(params.property_reference)
  if (!imovel) return { erro: `Imóvel ${params.property_reference} não encontrado.` }

  const dias = params.dias_a_frente ?? 7
  const agora = new Date()
  const equipe = await carregarEquipeParaImovel(imovel, agora, dias)

  if (equipe.corretores.length === 0) {
    return {
      erro:
        equipe.criterio === 'ninguem'
          ? 'Nenhum corretor ativo cadastrado.'
          : 'Nenhum corretor elegível tem agenda cadastrada — não há como oferecer horário. Ofereça escalar para a equipe.',
    }
  }

  const livres = gerarSlotsEquipe({
    agora,
    dias,
    corretores: equipe.corretores,
    ocupadosImovel: equipe.ocupadosImovel,
  })

  return {
    imovel: `${imovel.reference_code} — ${imovel.title}`,
    bairro: imovel.region,
    corretores_elegiveis: equipe.corretores.length,
    agora: `${agoraDescrito(agora)} (horário de São Paulo)`,
    horarios_livres: descreverHorarios(livres),
    instrucao: INSTRUCAO_HORARIOS,
  }
}

export async function handleCreateVisit(
  contactId: string,
  params: { property_reference: string; scheduled_at: string; type?: string }
) {
  const supabase = createAdminClient()
  const imovel = await acharImovel(params.property_reference)
  if (!imovel) return { agendado: false, erro: `Imóvel ${params.property_reference} não encontrado.` }

  const quando = interpretarDataHora(params.scheduled_at)
  if (!quando) {
    return { agendado: false, erro: 'Data inválida. Use o campo `quando` de check_broker_availability.' }
  }

  /* Recheca TUDO no momento de gravar — janela, almoço, bloqueio e conflito
     de cada corretor elegível — com o mesmo criterio da consulta. Entre o
     check e esta chamada passaram-se turnos de conversa, e outro lead pode ter
     ocupado o horario. */
  const agora = new Date()
  const equipe = await carregarEquipeParaImovel(imovel, agora, 14)

  if (equipe.corretores.length === 0) {
    return { agendado: false, erro: 'Nenhum corretor com agenda para este imóvel. Ofereça escalar para a equipe.' }
  }

  const alternativas = () =>
    descreverHorarios(
      gerarSlotsEquipe({
        agora,
        dias: 7,
        corretores: equipe.corretores,
        ocupadosImovel: equipe.ocupadosImovel,
        maximo: 6,
      })
    )

  const escolha = escolherCorretor(
    quando,
    { agora, corretores: equipe.corretores, ocupadosImovel: equipe.ocupadosImovel },
    equipe.preferidoId
  )

  if (!escolha.corretor) {
    /* Devolve alternativas na mesma resposta: o modelo nao precisa de outra
       rodada de tool, e nao tem como "oferecer de novo" o horario recusado. */
    return {
      agendado: false,
      erro: `${escolha.motivo} (${rotuloHorario(quando)})`,
      horarios_livres: alternativas(),
      instrucao: `Peça desculpa em meia linha e ofereça as alternativas acima. ${INSTRUCAO_HORARIOS}`,
    }
  }

  const corretor = escolha.corretor

  const { data: visita, error } = await supabase
    .from('property_visits')
    .insert({
      contact_id: contactId,
      property_id: imovel.id,
      broker_id: corretor.id,
      scheduled_at: quando.toISOString(),
      type: params.type ?? 'visita',
      status: 'agendada',
    })
    .select('id')
    .single()

  if (error) {
    /* 23505 = um dos indices unicos pegou uma confirmacao simultanea — mesmo
       corretor no mesmo horario, ou mesmo IMOVEL no mesmo horario. Nao e falha
       do sistema: e o choque que o indice existe para impedir. Trata como
       "ocupado" e oferece outros. */
    if (error.code === '23505') {
      return {
        agendado: false,
        erro: `Esse horário acabou de ser ocupado por outra visita (${rotuloHorario(quando)}).`,
        horarios_livres: alternativas(),
        instrucao: `Peça desculpa em meia linha e ofereça as alternativas acima. ${INSTRUCAO_HORARIOS}`,
      }
    }
    return { agendado: false, erro: error.message }
  }

  await supabase
    .from('contacts')
    .update({
      funnel_stage: 'visita_agendada',
      assigned_broker_id: corretor.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId)

  return {
    agendado: true,
    visita_id: visita.id,
    imovel: `${imovel.reference_code} — ${imovel.title}`,
    quando: isoComFuso(quando),
    descricao: rotuloHorario(quando),
    duracao_min: DURACAO_VISITA_MIN,
    corretor: contatoDoCorretor(corretor),
    instrucao:
      'Confirme em uma mensagem curta: dia e hora (use `descricao`), imóvel, e QUEM vai receber a pessoa — nome do corretor e telefone (e e-mail, se houver). O cliente precisa saber com quem falar no dia.',
  }
}
