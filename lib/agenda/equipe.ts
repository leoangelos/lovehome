// ==========================================
// Quem pode atender uma visita — e a agenda de cada um, carregada de uma vez.
//
// Um imóvel tem um corretor responsável (properties.broker_id), mas a visita
// pode ser feita por qualquer corretor ativo que atenda o bairro
// (brokers.region_focus). É isso que faz "mais de um corretor disponível no
// mesmo horário" ser normal: os horários oferecidos ao cliente são a união das
// agendas, e o corretor é definido na confirmação — e informado ao cliente
// junto com o contato.
//
// Se ninguém cobre o bairro e o responsável não está ativo, cai para todos os
// corretores ativos com agenda: pior do que o corretor certo, muito melhor do
// que "não tem horário".
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import type { AgendaCorretor, Bloqueio, JanelaAgenda } from './slots'

export interface CorretorDaEquipe extends AgendaCorretor {
  telefone: string | null
  email: string | null
}

export interface Equipe {
  corretores: CorretorDaEquipe[]
  /** O responsável pelo imóvel, quando está entre os elegíveis. */
  preferidoId: string | null
  /** Visitas ativas já marcadas NESTE imóvel (qualquer corretor), em ms. */
  ocupadosImovel: number[]
  /** Como a equipe foi montada — vai para o trace da tool. */
  criterio: 'responsavel_e_regiao' | 'todos_ativos' | 'ninguem'
}

/** 'Vila Mariana' ~ 'vila mariana' ~ 'VILA  MARIANA'. */
export function normalizarRegiao(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

interface LinhaCorretor {
  id: string
  name: string
  phone: string | null
  email: string | null
  region_focus: string[] | null
}

/** Regra de elegibilidade, separada para o check exercitar sem banco. */
export function filtrarElegiveis(
  corretoresAtivos: LinhaCorretor[],
  imovel: { broker_id: string | null; region: string }
): { elegiveis: LinhaCorretor[]; criterio: Equipe['criterio'] } {
  const regiao = normalizarRegiao(imovel.region)
  const elegiveis = corretoresAtivos.filter(
    (c) =>
      c.id === imovel.broker_id ||
      (c.region_focus ?? []).some((r) => normalizarRegiao(r) === regiao)
  )
  if (elegiveis.length > 0) return { elegiveis, criterio: 'responsavel_e_regiao' }
  if (corretoresAtivos.length > 0) return { elegiveis: corretoresAtivos, criterio: 'todos_ativos' }
  return { elegiveis: [], criterio: 'ninguem' }
}

export async function carregarEquipeParaImovel(
  imovel: { id: string; broker_id: string | null; region: string },
  agora: Date,
  dias: number
): Promise<Equipe> {
  const supabase = createAdminClient()
  const limite = new Date(agora.getTime() + dias * 24 * 60 * 60 * 1000)

  const [{ data: ativos }, { data: visitasDoImovel }] = await Promise.all([
    supabase
      .from('brokers')
      .select('id, name, phone, email, region_focus')
      .eq('is_active', true)
      .order('name'),
    /* Visitas do IMÓVEL, com qualquer corretor. É o que impede duas pessoas
       no mesmo apartamento no mesmo horário com corretores diferentes. */
    supabase
      .from('property_visits')
      .select('scheduled_at')
      .eq('property_id', imovel.id)
      .in('status', ['agendada', 'confirmada'])
      .gte('scheduled_at', agora.toISOString())
      .lte('scheduled_at', limite.toISOString()),
  ])

  const ocupadosImovel = (visitasDoImovel ?? []).map((v) => new Date(v.scheduled_at).getTime())

  const { elegiveis, criterio } = filtrarElegiveis((ativos ?? []) as LinhaCorretor[], imovel)
  if (elegiveis.length === 0) return { corretores: [], preferidoId: null, ocupadosImovel, criterio }

  const ids = elegiveis.map((c) => c.id)

  const [{ data: janelas }, { data: bloqueios }, { data: visitas }] = await Promise.all([
    supabase
      .from('broker_availability')
      .select('broker_id, weekday, start_time, end_time, break_start, break_end')
      .in('broker_id', ids),
    supabase
      .from('broker_blocked_slots')
      .select('broker_id, starts_at, ends_at')
      .in('broker_id', ids)
      .lte('starts_at', limite.toISOString())
      .gte('ends_at', agora.toISOString()),
    supabase
      .from('property_visits')
      .select('broker_id, scheduled_at')
      .in('broker_id', ids)
      .in('status', ['agendada', 'confirmada'])
      .gte('scheduled_at', agora.toISOString())
      .lte('scheduled_at', limite.toISOString()),
  ])

  const corretores: CorretorDaEquipe[] = elegiveis
    .map((c) => ({
      id: c.id,
      nome: c.name,
      telefone: c.phone,
      email: c.email,
      janelas: ((janelas ?? []) as (JanelaAgenda & { broker_id: string })[]).filter((j) => j.broker_id === c.id),
      bloqueios: ((bloqueios ?? []) as (Bloqueio & { broker_id: string })[]).filter((b) => b.broker_id === c.id),
      ocupados: (visitas ?? [])
        .filter((v) => v.broker_id === c.id)
        .map((v) => new Date(v.scheduled_at).getTime()),
    }))
    /* Corretor sem agenda cadastrada não gera horário nenhum — fica de fora
       da equipe em vez de ser "elegível" e nunca escolhido. */
    .filter((c) => c.janelas.length > 0)

  const preferidoId = corretores.some((c) => c.id === imovel.broker_id) ? imovel.broker_id : null

  return { corretores, preferidoId, ocupadosImovel, criterio }
}
