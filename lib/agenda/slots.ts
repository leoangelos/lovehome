// ==========================================
// Geração de horários livres — parte pura, sem banco.
//
// Recebe a agenda do corretor (janelas por dia da semana com intervalo de
// almoço, bloqueios, visitas já marcadas) e devolve os instantes livres. Tudo
// em relógio de São Paulo via lib/agenda/fuso; o único motivo de existir
// separado de tools/visits.ts é poder testar com TZ=UTC e provar que 09:00
// continua sendo 09:00 em SP.
//
// A MESMA função decide "livre" na consulta e na confirmação (create_visit).
// Antes eram dois cálculos diferentes, e a divergência entre eles era o loop
// "está livre → está ocupado → está livre".
//
// Vários corretores: um imóvel pode ser visitado por qualquer corretor
// elegível (o responsável ou quem atende o bairro). Os horários oferecidos são
// a UNIÃO das agendas; na confirmação, um deles é escolhido para aquele slot.
// ==========================================

import { instanteLocal, partesLocais } from './fuso'

export interface JanelaAgenda {
  weekday: number
  /** 'HH:MM' ou 'HH:MM:SS' (TIME do Postgres) */
  start_time: string
  end_time: string
  /** Intervalo de almoço dentro da janela — ambos ou nenhum. */
  break_start?: string | null
  break_end?: string | null
}

export interface Bloqueio {
  starts_at: string
  ends_at: string
}

/** A agenda de UM corretor, já carregada. */
export interface AgendaCorretor {
  id: string
  nome: string
  janelas: JanelaAgenda[]
  bloqueios: Bloqueio[]
  /** Instantes (ms) das visitas já marcadas. */
  ocupados: number[]
}

export interface ParametrosSlots {
  agora: Date
  dias: number
  janelas: JanelaAgenda[]
  bloqueios: Bloqueio[]
  /** Instantes (ms) das visitas já marcadas do corretor. */
  ocupados: number[]
  /** Duração de uma visita — define o que é conflito. */
  duracaoMin?: number
  /** Nada de propor daqui a meia hora. */
  antecedenciaMin?: number
  maximo?: number
}

/* Janela de 1h, alinhada na hora cheia. E o combinado da operacao e o que
   torna "mesmo instante" sinonimo de "mesmo slot" no indice unico do banco. */
export const DURACAO_VISITA_MIN = 60
const ANTECEDENCIA_PADRAO_MIN = 120

export function minutosDe(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

/** O instante bate com alguma janela semanal do corretor (hora de SP), fora do almoço? */
export function dentroDaJanela(instante: Date, janelas: JanelaAgenda[], duracaoMin = DURACAO_VISITA_MIN): boolean {
  const p = partesLocais(instante)
  const inicio = p.hora * 60 + p.minuto
  const fim = inicio + duracaoMin
  return janelas.some((j) => {
    if (j.weekday !== p.diaSemana) return false
    if (inicio < minutosDe(j.start_time) || fim > minutosDe(j.end_time)) return false
    if (j.break_start && j.break_end) {
      // Visita que encosta no almoço não serve: [inicio, fim) ∩ [almoço) vazio.
      const aIni = minutosDe(j.break_start)
      const aFim = minutosDe(j.break_end)
      if (inicio < aFim && fim > aIni) return false
    }
    return true
  })
}

/** O slot cai no almoço (para dar o motivo certo, e não "não atende"). */
export function noAlmoco(instante: Date, janelas: JanelaAgenda[], duracaoMin = DURACAO_VISITA_MIN): boolean {
  const p = partesLocais(instante)
  const inicio = p.hora * 60 + p.minuto
  const fim = inicio + duracaoMin
  return janelas.some(
    (j) =>
      j.weekday === p.diaSemana &&
      j.break_start &&
      j.break_end &&
      inicio < minutosDe(j.break_end) &&
      fim > minutosDe(j.break_start)
  )
}

export function conflitaComVisita(instante: Date, ocupados: number[], duracaoMin = DURACAO_VISITA_MIN): boolean {
  const t = instante.getTime()
  return ocupados.some((o) => Math.abs(o - t) < duracaoMin * 60_000)
}

export function conflitaComBloqueio(instante: Date, bloqueios: Bloqueio[]): boolean {
  const t = instante.getTime()
  return bloqueios.some((b) => t >= new Date(b.starts_at).getTime() && t < new Date(b.ends_at).getTime())
}

/** Por que um horário específico NÃO serve para este corretor — ou null se serve. */
export function motivoIndisponivel(
  instante: Date,
  ctx: Pick<ParametrosSlots, 'agora' | 'janelas' | 'bloqueios' | 'ocupados' | 'duracaoMin' | 'antecedenciaMin'>
): string | null {
  const antecedencia = (ctx.antecedenciaMin ?? ANTECEDENCIA_PADRAO_MIN) * 60_000
  if (instante.getTime() < ctx.agora.getTime()) return 'Esse horário já passou.'
  if (instante.getTime() < ctx.agora.getTime() + antecedencia) return 'Muito em cima da hora — o corretor precisa de pelo menos 2 horas de aviso.'
  if (noAlmoco(instante, ctx.janelas, ctx.duracaoMin)) return 'É o horário de almoço do corretor.'
  if (!dentroDaJanela(instante, ctx.janelas, ctx.duracaoMin)) return 'O corretor não atende nesse dia/horário.'
  if (conflitaComBloqueio(instante, ctx.bloqueios)) return 'O corretor está bloqueado nesse horário.'
  if (conflitaComVisita(instante, ctx.ocupados, ctx.duracaoMin)) return 'Esse horário acabou de ser ocupado por outra visita.'
  return null
}

/** Horários livres de UM corretor, de hora em hora, em ordem cronológica. */
export function gerarSlotsLivres(params: ParametrosSlots): Date[] {
  const { agora, dias, janelas } = params
  const duracao = params.duracaoMin ?? DURACAO_VISITA_MIN
  const maximo = params.maximo ?? 12
  const hoje = partesLocais(agora)
  const livres: Date[] = []

  for (let d = 0; d < dias && livres.length < maximo; d++) {
    // Meio-dia como âncora evita cair no dia errado por qualquer deslocamento.
    const diaLocal = partesLocais(instanteLocal(hoje.ano, hoje.mes, hoje.dia + d, 12))
    const janelasDoDia = janelas
      .filter((j) => j.weekday === diaLocal.diaSemana)
      .sort((a, b) => minutosDe(a.start_time) - minutosDe(b.start_time))

    for (const janela of janelasDoDia) {
      const inicio = minutosDe(janela.start_time)
      const fim = minutosDe(janela.end_time)

      for (let h = Math.ceil(inicio / 60); h * 60 + duracao <= fim; h++) {
        const slot = instanteLocal(diaLocal.ano, diaLocal.mes, diaLocal.dia, h, 0)
        if (motivoIndisponivel(slot, { ...params, duracaoMin: duracao }) !== null) continue
        livres.push(slot)
        if (livres.length >= maximo) break
      }
      if (livres.length >= maximo) break
    }
  }

  return livres
}

// ==========================================
// Vários corretores
// ==========================================

export interface ParametrosEquipe {
  agora: Date
  dias: number
  corretores: AgendaCorretor[]
  /**
   * Instantes (ms) das visitas já marcadas NO IMÓVEL, com qualquer corretor.
   * Um imóvel recebe uma visita por vez: duas pessoas com corretores
   * diferentes no mesmo apartamento no mesmo horário é o conflito que a agenda
   * por corretor sozinha não enxerga.
   */
  ocupadosImovel?: number[]
  duracaoMin?: number
  antecedenciaMin?: number
  maximo?: number
}

const MOTIVO_IMOVEL_OCUPADO = 'Esse imóvel já tem visita marcada nesse horário (com outro corretor).'

/**
 * União dos horários livres da equipe elegível, em ordem cronológica, sem
 * repetição. Um slot aparece se PELO MENOS UM corretor está livre nele.
 */
export function gerarSlotsEquipe(params: ParametrosEquipe): Date[] {
  const { corretores, maximo = 12, ocupadosImovel = [], ...resto } = params
  const vistos = new Map<number, Date>()

  for (const c of corretores) {
    /* maximo grande por corretor: o corte e feito na uniao, senao um corretor
       cheio de manha esconderia a tarde de outro. */
    for (const s of gerarSlotsLivres({ ...resto, ...c, maximo: 200 })) {
      if (conflitaComVisita(s, ocupadosImovel, resto.duracaoMin)) continue
      if (!vistos.has(s.getTime())) vistos.set(s.getTime(), s)
    }
  }

  return [...vistos.values()].sort((a, b) => a.getTime() - b.getTime()).slice(0, maximo)
}

/**
 * Quem atende este slot. Preferência: o corretor responsável pelo imóvel, se
 * estiver livre; senão, entre os livres, quem tem menos visitas naquele dia
 * (distribui carga); empate → ordem alfabética, para ser determinístico.
 * Devolve null se ninguém está livre — e o motivo do responsável (ou do
 * primeiro), para o agente explicar.
 */
export function escolherCorretor<C extends AgendaCorretor>(
  slot: Date,
  params: Pick<ParametrosEquipe, 'agora' | 'duracaoMin' | 'antecedenciaMin' | 'ocupadosImovel'> & { corretores: C[] },
  preferidoId: string | null
): { corretor: C | null; motivo: string | null } {
  const { corretores, ocupadosImovel = [], ...ctx } = params

  /* Antes de olhar corretor: o imovel ja esta ocupado nesse horario? Nao
     importa quem estaria livre — ninguem leva duas familias ao mesmo
     apartamento ao mesmo tempo. */
  if (conflitaComVisita(slot, ocupadosImovel, ctx.duracaoMin)) {
    return { corretor: null, motivo: MOTIVO_IMOVEL_OCUPADO }
  }

  const livres: C[] = []
  let motivoPreferido: string | null = null

  for (const c of corretores) {
    const motivo = motivoIndisponivel(slot, { ...ctx, ...c })
    if (motivo === null) livres.push(c)
    else if (c.id === preferidoId || motivoPreferido === null) motivoPreferido = motivo
  }

  if (livres.length === 0) {
    return { corretor: null, motivo: motivoPreferido ?? 'Nenhum corretor disponível nesse horário.' }
  }

  const preferido = livres.find((c) => c.id === preferidoId)
  if (preferido) return { corretor: preferido, motivo: null }

  const dia = partesLocais(slot)
  const visitasNoDia = (c: C) =>
    c.ocupados.filter((t) => {
      const p = partesLocais(new Date(t))
      return p.ano === dia.ano && p.mes === dia.mes && p.dia === dia.dia
    }).length

  livres.sort((a, b) => visitasNoDia(a) - visitasNoDia(b) || a.nome.localeCompare(b.nome, 'pt-BR'))
  return { corretor: livres[0], motivo: null }
}

/**
 * Para REAGENDAR: tira a própria visita da ocupação do corretor dela e do
 * imóvel. Sem isto, mover de 10h para 11h esbarraria na regra de "1h de
 * distância" contra si mesma, e o imóvel pareceria ocupado por ela.
 */
export function semAPropriaVisita<C extends AgendaCorretor>(
  corretores: C[],
  ocupadosImovel: number[],
  visita: { brokerId: string | null; instanteMs: number }
): { corretores: C[]; ocupadosImovel: number[] } {
  const tirar = (lista: number[]) => lista.filter((t) => t !== visita.instanteMs)
  return {
    corretores: corretores.map((c) => (c.id === visita.brokerId ? { ...c, ocupados: tirar(c.ocupados) } : c)),
    ocupadosImovel: tirar(ocupadosImovel),
  }
}
