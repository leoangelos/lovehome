// ==========================================
// Edição de corretor pelo painel: contato, áreas de atuação e agenda semanal.
//
// Fora da rota HTTP para ser testável sem subir sessão. A validação vive aqui
// e não no formulário: o que chega do navegador é entrada externa, e a agenda
// é o que o agente de agendamento usa para prometer horário a cliente — um
// almoço "13:00–12:00" salvo por engano é um dia inteiro sem visitas.
//
// Regras da agenda (as mesmas do CHECK da migration 035, aplicadas antes para
// a mensagem de erro ser legível):
//   * uma linha por dia da semana, hora cheia ou meia hora ('HH:MM');
//   * fim > início; almoço, se houver, dentro da janela e com fim > início;
//   * a janela precisa caber pelo menos uma visita de 1h.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { ensureBrCountryCode } from '@/lib/utils/phone'
import { DURACAO_VISITA_MIN, minutosDe } from '@/lib/agenda/slots'

export type Resultado = { ok: true } | { ok: false; erro: string; status: number }

export const ESPECIALIDADES = ['residencial', 'investimento', 'comercial', 'geral'] as const
export type Especialidade = (typeof ESPECIALIDADES)[number]

export interface DiaAgenda {
  weekday: number
  start_time: string
  end_time: string
  break_start?: string | null
  break_end?: string | null
}

export interface EntradaCorretor {
  name?: string
  email?: string | null
  phone?: string | null
  specialty?: Especialidade | null
  is_active?: boolean
  region_focus?: string[]
  agenda?: DiaAgenda[]
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/** Normaliza 'HH:MM:SS' → 'HH:MM' e valida. */
function hora(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const curta = valor.trim().slice(0, 5)
  return HORA.test(curta) ? curta : null
}

/** Regra pura — o check exercita sem banco. Devolve a agenda normalizada ou o erro. */
export function validarAgenda(agenda: unknown): { ok: true; dias: DiaAgenda[] } | { ok: false; erro: string } {
  if (!Array.isArray(agenda)) return { ok: false, erro: 'Agenda inválida.' }

  const vistos = new Set<number>()
  const dias: DiaAgenda[] = []

  for (const item of agenda as Record<string, unknown>[]) {
    const weekday = Number(item?.weekday)
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return { ok: false, erro: 'Dia da semana inválido.' }
    }
    if (vistos.has(weekday)) return { ok: false, erro: `${DIAS[weekday]} aparece duas vezes.` }
    vistos.add(weekday)

    const inicio = hora(item.start_time)
    const fim = hora(item.end_time)
    if (!inicio || !fim) return { ok: false, erro: `${DIAS[weekday]}: horário no formato HH:MM.` }
    if (minutosDe(fim) <= minutosDe(inicio)) return { ok: false, erro: `${DIAS[weekday]}: o fim precisa ser depois do início.` }
    if (minutosDe(fim) - minutosDe(inicio) < DURACAO_VISITA_MIN) {
      return { ok: false, erro: `${DIAS[weekday]}: a janela precisa caber uma visita de 1h.` }
    }

    const temAlmocoIni = item.break_start != null && item.break_start !== ''
    const temAlmocoFim = item.break_end != null && item.break_end !== ''
    let break_start: string | null = null
    let break_end: string | null = null

    if (temAlmocoIni || temAlmocoFim) {
      if (!temAlmocoIni || !temAlmocoFim) {
        return { ok: false, erro: `${DIAS[weekday]}: informe início E fim do almoço, ou deixe os dois vazios.` }
      }
      break_start = hora(item.break_start)
      break_end = hora(item.break_end)
      if (!break_start || !break_end) return { ok: false, erro: `${DIAS[weekday]}: almoço no formato HH:MM.` }
      if (minutosDe(break_end) <= minutosDe(break_start)) {
        return { ok: false, erro: `${DIAS[weekday]}: o fim do almoço precisa ser depois do início.` }
      }
      if (minutosDe(break_start) < minutosDe(inicio) || minutosDe(break_end) > minutosDe(fim)) {
        return { ok: false, erro: `${DIAS[weekday]}: o almoço precisa estar dentro do horário de atendimento.` }
      }
    }

    dias.push({ weekday, start_time: inicio, end_time: fim, break_start, break_end })
  }

  return { ok: true, dias: dias.sort((a, b) => a.weekday - b.weekday) }
}

/** Áreas de atuação: texto limpo, sem repetição (ignorando caixa), sem vazio. */
export function validarRegioes(regioes: unknown): { ok: true; regioes: string[] } | { ok: false; erro: string } {
  if (!Array.isArray(regioes)) return { ok: false, erro: 'Áreas de atuação inválidas.' }
  const vistas = new Set<string>()
  const limpas: string[] = []
  for (const r of regioes) {
    if (typeof r !== 'string') return { ok: false, erro: 'Áreas de atuação inválidas.' }
    const texto = r.replace(/\s+/g, ' ').trim()
    if (!texto) continue
    if (texto.length > 60) return { ok: false, erro: `Área "${texto.slice(0, 20)}…" longa demais.` }
    const chave = texto.toLowerCase()
    if (vistas.has(chave)) continue
    vistas.add(chave)
    limpas.push(texto)
  }
  return { ok: true, regioes: limpas }
}

export async function salvarCorretor(brokerId: string, entrada: EntradaCorretor): Promise<Resultado> {
  const supabase = createAdminClient()

  const { data: existente } = await supabase.from('brokers').select('id').eq('id', brokerId).maybeSingle()
  if (!existente) return { ok: false, erro: 'Corretor não encontrado.', status: 404 }

  const campos: Record<string, unknown> = {}

  if (entrada.name !== undefined) {
    const nome = String(entrada.name).trim()
    if (nome.length < 2) return { ok: false, erro: 'Nome curto demais.', status: 400 }
    campos.name = nome
  }

  if (entrada.email !== undefined) {
    const email = (entrada.email ?? '').trim().toLowerCase()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, erro: 'E-mail inválido.', status: 400 }
    }
    campos.email = email || null
  }

  if (entrada.phone !== undefined) {
    const digitos = (entrada.phone ?? '').replace(/\D/g, '')
    if (digitos && (digitos.length < 10 || digitos.length > 13)) {
      return { ok: false, erro: 'Telefone inválido — use DDD + número.', status: 400 }
    }
    /* Guardado com 55 na frente, como o resto do sistema: é o que vai para o
       cliente na confirmação da visita e o que o WhatsApp entende. */
    campos.phone = digitos ? ensureBrCountryCode(digitos) : null
  }

  if (entrada.specialty !== undefined) {
    if (entrada.specialty !== null && !ESPECIALIDADES.includes(entrada.specialty)) {
      return { ok: false, erro: 'Especialidade inválida.', status: 400 }
    }
    campos.specialty = entrada.specialty
  }

  if (entrada.is_active !== undefined) campos.is_active = Boolean(entrada.is_active)

  if (entrada.region_focus !== undefined) {
    const r = validarRegioes(entrada.region_focus)
    if (!r.ok) return { ok: false, erro: r.erro, status: 400 }
    campos.region_focus = r.regioes
  }

  let agenda: DiaAgenda[] | null = null
  if (entrada.agenda !== undefined) {
    const a = validarAgenda(entrada.agenda)
    if (!a.ok) return { ok: false, erro: a.erro, status: 400 }
    agenda = a.dias
  }

  if (Object.keys(campos).length > 0) {
    const { error } = await supabase.from('brokers').update(campos).eq('id', brokerId)
    if (error) return { ok: false, erro: `Não foi possível salvar: ${error.message}`, status: 500 }
  }

  if (agenda) {
    /* Substitui a semana inteira. Não é atômico (dois comandos), mas a janela
       é de milissegundos e o pior caso — uma consulta de agenda entre os dois
       — devolve "sem agenda" por um instante, sem gravar nada errado. */
    const { error: erroApagar } = await supabase.from('broker_availability').delete().eq('broker_id', brokerId)
    if (erroApagar) return { ok: false, erro: `Não foi possível atualizar a agenda: ${erroApagar.message}`, status: 500 }

    if (agenda.length > 0) {
      const { error: erroInserir } = await supabase
        .from('broker_availability')
        .insert(agenda.map((d) => ({ broker_id: brokerId, ...d })))
      if (erroInserir) return { ok: false, erro: `Não foi possível gravar a agenda: ${erroInserir.message}`, status: 500 }
    }
  }

  return { ok: true }
}
