// ==========================================
// Cancelar, reagendar e mudar status de visita — a regra, fora da rota HTTP e
// fora da tool, para o agente (WhatsApp) e o painel fazerem a MESMA coisa.
//
// O que importa aqui:
//   * Cancelar muda o status. Os índices únicos parciais (035) só valem para
//     visitas ativas, então a janela fica livre na hora — não existe passo
//     "liberar horário".
//   * Reagendar MOVE a mesma linha (scheduled_at e, se preciso, broker_id).
//     Não cria outra visita: a antiga sumiria da agenda mas continuaria
//     ocupando o slot até alguém lembrar de cancelar. O novo horário passa
//     pelo mesmo critério de "livre" da consulta (lib/agenda/slots), com a
//     mesma equipe elegível — e o corretor pode mudar; quem confirma precisa
//     dizer isso ao cliente.
//   * Quem pode: o próprio cliente (contact_id da visita) pelo agente; no
//     painel, quem tem `visitas` + `editar` — corretor só nas visitas dele.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { isoComFuso, rotuloHorario } from './fuso'
import { carregarEquipeParaImovel, type CorretorDaEquipe } from './equipe'
import { escolherCorretor, gerarSlotsEquipe, semAPropriaVisita } from './slots'

export type Resultado<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; erro: string; status: number; horarios_livres?: { quando: string; descricao: string }[] }

/** Quem está pedindo — decide a checagem de posse. */
export type Autor =
  | { tipo: 'cliente'; contactId: string }
  | { tipo: 'painel'; brokerId: string | null; recorteProprio: boolean }

const ATIVAS = ['agendada', 'confirmada']

interface VisitaCarregada {
  id: string
  contact_id: string
  property_id: string | null
  broker_id: string | null
  scheduled_at: string
  status: string
  type: string
  properties: { id: string; reference_code: string; title: string; region: string; broker_id: string | null } | null
  brokers: { name: string; phone: string | null; email: string | null } | null
  contacts: { name: string | null } | null
}

async function carregarVisita(visitaId: string): Promise<VisitaCarregada | null> {
  const { data } = await createAdminClient()
    .from('property_visits')
    .select(
      `id, contact_id, property_id, broker_id, scheduled_at, status, type,
       properties ( id, reference_code, title, region, broker_id ),
       brokers ( name, phone, email ),
       contacts ( name )`
    )
    .eq('id', visitaId)
    .maybeSingle()
  return (data as unknown as VisitaCarregada) ?? null
}

function podeMexer(v: VisitaCarregada, autor: Autor): boolean {
  if (autor.tipo === 'cliente') return v.contact_id === autor.contactId
  if (!autor.recorteProprio) return true
  return !!v.broker_id && v.broker_id === autor.brokerId
}

function descreverVisita(v: VisitaCarregada) {
  return {
    visita_id: v.id,
    quando: isoComFuso(new Date(v.scheduled_at)),
    descricao: rotuloHorario(new Date(v.scheduled_at)),
    status: v.status,
    imovel: v.properties ? `${v.properties.reference_code} — ${v.properties.title}` : null,
    corretor: v.brokers ? { nome: v.brokers.name, telefone: v.brokers.phone, email: v.brokers.email } : null,
  }
}

/** Visitas ativas daqui pra frente de um contato — o que o agente precisa para saber "qual visita". */
export async function listarVisitasDoContato(contactId: string) {
  const { data, error } = await createAdminClient()
    .from('property_visits')
    .select(
      `id, contact_id, property_id, broker_id, scheduled_at, status, type,
       properties ( id, reference_code, title, region, broker_id ),
       brokers ( name, phone, email ),
       contacts ( name )`
    )
    .eq('contact_id', contactId)
    .in('status', ATIVAS)
    .gte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })

  if (error) return { ok: false as const, erro: 'Não consegui consultar as visitas.', status: 500 }
  return { ok: true as const, visitas: ((data ?? []) as unknown as VisitaCarregada[]).map(descreverVisita) }
}

/**
 * Cancela. Não apaga: a linha vira histórico (quem cancelou, quando, por quê),
 * e o slot é liberado pelo índice parcial.
 */
export async function cancelarVisita(params: {
  visitaId: string
  autor: Autor
  motivo?: string | null
}): Promise<Resultado<{ visita: ReturnType<typeof descreverVisita>; contactId: string }>> {
  const v = await carregarVisita(params.visitaId)
  if (!v) return { ok: false, erro: 'Visita não encontrada.', status: 404 }
  if (!podeMexer(v, params.autor)) return { ok: false, erro: 'Esta visita não é sua.', status: 403 }
  if (!ATIVAS.includes(v.status)) {
    return { ok: false, erro: `Esta visita já está ${v.status} — não há o que cancelar.`, status: 409 }
  }

  const { error } = await createAdminClient()
    .from('property_visits')
    .update({
      status: 'cancelada',
      cancelled_at: new Date().toISOString(),
      cancel_reason: (params.motivo ?? '').trim().slice(0, 300) || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', v.id)

  if (error) return { ok: false, erro: 'Não foi possível cancelar.', status: 500 }
  return { ok: true, visita: descreverVisita(v), contactId: v.contact_id }
}

/**
 * Move a visita para outro horário. Mesmo critério de "livre" do
 * check_broker_availability, mesma equipe elegível. Se ninguém está livre no
 * novo horário, devolve alternativas — e NÃO mexe na visita atual: a pessoa
 * continua com o horário antigo até escolher um que sirva.
 */
export async function reagendarVisita(params: {
  visitaId: string
  novoQuando: Date
  autor: Autor
}): Promise<
  Resultado<{
    visita: ReturnType<typeof descreverVisita>
    anterior: { quando: string; descricao: string }
    corretor: { nome: string; telefone: string | null; email: string | null }
    trocouCorretor: boolean
    contactId: string
  }>
> {
  const v = await carregarVisita(params.visitaId)
  if (!v) return { ok: false, erro: 'Visita não encontrada.', status: 404 }
  if (!podeMexer(v, params.autor)) return { ok: false, erro: 'Esta visita não é sua.', status: 403 }
  if (!ATIVAS.includes(v.status)) {
    return { ok: false, erro: `Esta visita está ${v.status} — marque uma nova em vez de reagendar.`, status: 409 }
  }
  if (!v.properties) return { ok: false, erro: 'Visita sem imóvel — não dá para reagendar.', status: 422 }

  const anteriorMs = new Date(v.scheduled_at).getTime()
  if (params.novoQuando.getTime() === anteriorMs) {
    return { ok: false, erro: 'É o mesmo horário que já está marcado.', status: 409 }
  }

  const agora = new Date()
  const equipe = await carregarEquipeParaImovel(
    { id: v.properties.id, broker_id: v.properties.broker_id, region: v.properties.region },
    agora,
    14
  )

  /* A PRÓPRIA visita não conta como ocupação: ela está sendo movida. */
  const { corretores, ocupadosImovel } = semAPropriaVisita<CorretorDaEquipe>(
    equipe.corretores,
    equipe.ocupadosImovel,
    { brokerId: v.broker_id, instanteMs: anteriorMs }
  )

  const alternativas = () =>
    gerarSlotsEquipe({ agora, dias: 7, corretores, ocupadosImovel, maximo: 6 }).map((s) => ({
      quando: isoComFuso(s),
      descricao: rotuloHorario(s),
    }))

  if (corretores.length === 0) {
    return { ok: false, erro: 'Nenhum corretor com agenda para este imóvel.', status: 422 }
  }

  /* Preferência: manter o corretor atual (a pessoa já sabe quem é); depois o
     responsável pelo imóvel; depois quem tiver menos carga. */
  const escolha = escolherCorretor(
    params.novoQuando,
    { agora, corretores, ocupadosImovel },
    corretores.some((c) => c.id === v.broker_id) ? v.broker_id : equipe.preferidoId
  )
  if (!escolha.corretor) {
    return {
      ok: false,
      erro: `${escolha.motivo} (${rotuloHorario(params.novoQuando)})`,
      status: 409,
      horarios_livres: alternativas(),
    }
  }

  const { error } = await createAdminClient()
    .from('property_visits')
    .update({
      scheduled_at: params.novoQuando.toISOString(),
      broker_id: escolha.corretor.id,
      status: 'agendada',
      rescheduled_from: v.scheduled_at,
      updated_at: new Date().toISOString(),
    })
    .eq('id', v.id)

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        erro: `Esse horário acabou de ser ocupado (${rotuloHorario(params.novoQuando)}).`,
        status: 409,
        horarios_livres: alternativas(),
      }
    }
    return { ok: false, erro: 'Não foi possível reagendar.', status: 500 }
  }

  const c = escolha.corretor
  return {
    ok: true,
    visita: {
      ...descreverVisita(v),
      quando: isoComFuso(params.novoQuando),
      descricao: rotuloHorario(params.novoQuando),
      status: 'agendada',
      corretor: { nome: c.nome, telefone: c.telefone, email: c.email },
    },
    anterior: { quando: isoComFuso(new Date(v.scheduled_at)), descricao: rotuloHorario(new Date(v.scheduled_at)) },
    corretor: { nome: c.nome, telefone: c.telefone, email: c.email },
    trocouCorretor: c.id !== v.broker_id,
    contactId: v.contact_id,
  }
}

/** Transições que o painel faz sem reagendar. Cancelar tem função própria (motivo). */
export type StatusPainel = 'confirmada' | 'realizada' | 'no_show'

export async function mudarStatusVisita(params: {
  visitaId: string
  status: StatusPainel
  autor: Autor
}): Promise<Resultado<{ visita: ReturnType<typeof descreverVisita>; contactId: string }>> {
  const v = await carregarVisita(params.visitaId)
  if (!v) return { ok: false, erro: 'Visita não encontrada.', status: 404 }
  if (!podeMexer(v, params.autor)) return { ok: false, erro: 'Esta visita não é sua.', status: 403 }
  if (v.status === 'cancelada') return { ok: false, erro: 'Visita cancelada não muda de status.', status: 409 }
  if (params.status === 'confirmada' && v.status !== 'agendada') {
    return { ok: false, erro: `Só visita agendada pode ser confirmada (esta está ${v.status}).`, status: 409 }
  }

  const { error } = await createAdminClient()
    .from('property_visits')
    .update({ status: params.status, updated_at: new Date().toISOString() })
    .eq('id', v.id)

  if (error) return { ok: false, erro: 'Não foi possível atualizar.', status: 500 }
  return { ok: true, visita: { ...descreverVisita(v), status: params.status }, contactId: v.contact_id }
}
