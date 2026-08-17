// ==========================================
// Fuso horário da operação — America/Sao_Paulo.
//
// O servidor roda em UTC (Vercel). Tudo que é "hora de gente" — janela do
// corretor (09:00–18:00), "quinta às 10h", "amanhã de manhã" — é hora de São
// Paulo. Misturar os dois foi o que quebrou o agendamento: a agenda gerava os
// horários em UTC (09:00Z = 06:00 em SP), o modelo lia "10:00" e dizia "10h",
// e ao confirmar criava a visita às 10h -03:00 (13:00Z) — outro instante, que
// podia estar ocupado. A agenda dizia livre, o create dizia ocupado, a agenda
// dizia livre de novo. Loop.
//
// Regra a partir daqui: qualquer conversão de/para relógio de parede passa por
// este módulo. `new Date().getHours()`, `setHours`, `getDay` fora daqui estão
// errados em produção.
// ==========================================

export const FUSO_BRASIL = 'America/Sao_Paulo'

export interface PartesLocais {
  ano: number
  mes: number // 1–12
  dia: number
  hora: number // 0–23
  minuto: number
  /** 0 = domingo … 6 = sábado (mesma convenção de Date.getDay e de broker_availability.weekday) */
  diaSemana: number
}

const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const INDICE_DIA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const FORMATO_PARTES = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_BRASIL,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
})

/** Relógio de parede de São Paulo para um instante. */
export function partesLocais(instante: Date): PartesLocais {
  const partes: Record<string, string> = {}
  for (const p of FORMATO_PARTES.formatToParts(instante)) partes[p.type] = p.value
  return {
    ano: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    hora: Number(partes.hour),
    minuto: Number(partes.minute),
    diaSemana: INDICE_DIA[partes.weekday] ?? new Date(instante).getUTCDay(),
  }
}

/** Deslocamento de São Paulo em relação a UTC, em minutos (hoje: -180). */
export function offsetMinutos(instante: Date): number {
  const p = partesLocais(instante)
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, instante.getUTCSeconds())
  return Math.round((comoUtc - instante.getTime()) / 60_000)
}

/**
 * Instante correspondente a um relógio de parede de São Paulo.
 * `dia` pode estourar o mês (dia 35 → normaliza), o que simplifica "hoje + N".
 */
export function instanteLocal(ano: number, mes: number, dia: number, hora = 0, minuto = 0): Date {
  const palpite = Date.UTC(ano, mes - 1, dia, hora, minuto)
  let deslocamento = offsetMinutos(new Date(palpite))
  let instante = palpite - deslocamento * 60_000
  /* Segunda passada cobre virada de horário de verão (o Brasil não tem desde
     2019, mas a função não deve depender disso). */
  const confere = offsetMinutos(new Date(instante))
  if (confere !== deslocamento) {
    deslocamento = confere
    instante = palpite - deslocamento * 60_000
  }
  return new Date(instante)
}

/** '2026-08-20T10:00:00-03:00' — o que vai para o modelo e volta dele. */
export function isoComFuso(instante: Date): string {
  const p = partesLocais(instante)
  const off = offsetMinutos(instante)
  const sinal = off < 0 ? '-' : '+'
  const abs = Math.abs(off)
  const dois = (n: number) => String(n).padStart(2, '0')
  return (
    `${p.ano}-${dois(p.mes)}-${dois(p.dia)}T${dois(p.hora)}:${dois(p.minuto)}:00` +
    `${sinal}${dois(Math.floor(abs / 60))}:${dois(abs % 60)}`
  )
}

/** 'quinta-feira 20/08 às 10h' (ou '10h30'). É o que o modelo repete para a pessoa. */
export function rotuloHorario(instante: Date): string {
  const p = partesLocais(instante)
  const dois = (n: number) => String(n).padStart(2, '0')
  const hora = p.minuto ? `${p.hora}h${dois(p.minuto)}` : `${p.hora}h`
  return `${DIAS_SEMANA[p.diaSemana]} ${dois(p.dia)}/${dois(p.mes)} às ${hora}`
}

/** 'segunda-feira, 17/08/2026, 16:36' — para o agente saber que dia é hoje. */
export function agoraDescrito(instante: Date = new Date()): string {
  const p = partesLocais(instante)
  const dois = (n: number) => String(n).padStart(2, '0')
  return `${DIAS_SEMANA[p.diaSemana]}, ${dois(p.dia)}/${dois(p.mes)}/${p.ano}, ${dois(p.hora)}:${dois(p.minuto)}`
}

const COM_FUSO = /(Z|[+-]\d{2}:?\d{2})$/i
const SEM_FUSO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * Lê o que o modelo mandou em `scheduled_at`. Com fuso explícito, respeita.
 * Sem fuso ("2026-08-20T10:00"), é hora de São Paulo — nunca UTC.
 */
export function interpretarDataHora(texto: string): Date | null {
  const limpo = (texto ?? '').trim()
  if (!limpo) return null

  const semFuso = limpo.match(SEM_FUSO)
  if (semFuso && !COM_FUSO.test(limpo)) {
    const [, a, m, d, h, mi] = semFuso
    return instanteLocal(Number(a), Number(m), Number(d), Number(h), Number(mi))
  }

  const dt = new Date(limpo)
  return Number.isNaN(dt.getTime()) ? null : dt
}

// ==========================================
// "Hoje", "início do dia" e formatação — o que o resto do sistema precisa
// para não fazer conta de calendário no relógio do servidor.
// ==========================================

const MESES_LONGOS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

const dois = (n: number) => String(n).padStart(2, '0')

/**
 * Meia-noite de São Paulo do dia `base + offsetDias`. Substitui o
 * `setHours(0,0,0,0)` + `setDate(...)` que, em UTC, dava meia-noite de Londres
 * — 21h do dia anterior no Brasil.
 */
export function inicioDoDiaLocal(offsetDias = 0, base: Date = new Date()): Date {
  const p = partesLocais(base)
  return instanteLocal(p.ano, p.mes, p.dia + offsetDias, 0, 0)
}

/** 'YYYY-MM-DD' do dia de São Paulo — chave de agrupamento por dia. */
export function dataIsoLocal(instante: Date): string {
  const p = partesLocais(instante)
  return `${p.ano}-${dois(p.mes)}-${dois(p.dia)}`
}

/** '17/08/2026' */
export function dataLocal(instante: Date): string {
  const p = partesLocais(instante)
  return `${dois(p.dia)}/${dois(p.mes)}/${p.ano}`
}

/** '17/08 16:36' — para listas e traces. */
export function dataHoraLocal(instante: Date): string {
  const p = partesLocais(instante)
  return `${dois(p.dia)}/${dois(p.mes)} ${dois(p.hora)}:${dois(p.minuto)}`
}

/** '17 de agosto de 2026' ou, com dia da semana, 'segunda-feira, 17 de agosto de 2026'. */
export function dataPorExtenso(instante: Date, comDiaSemana = false): string {
  const p = partesLocais(instante)
  const texto = `${p.dia} de ${MESES_LONGOS[p.mes - 1]} de ${p.ano}`
  return comDiaSemana ? `${DIAS_SEMANA[p.diaSemana]}, ${texto}` : texto
}
