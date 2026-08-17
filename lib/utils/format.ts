/* Formatadores pt-BR — portados de ref_layout/src/utils/format.js.
   Diferenca importante em relacao a referencia: o schema do LoveHome guarda
   dinheiro em centavos (colunas *_cents INTEGER, PRD 10), entao as funcoes de
   moeda recebem centavos, nao reais. Passar reais aqui infla o valor em 100x.

   Data e hora saem SEMPRE em horario de Sao Paulo (lib/agenda/fuso), rode isto
   no servidor (UTC) ou no navegador. */

import { dataHoraLocal, dataLocal } from '@/lib/agenda/fuso'

const MOEDA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
})

const INTEIRO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

/** 123456789 centavos → 'R$ 1.234.567,89' */
export function brl(centavos: number | null | undefined): string {
  return MOEDA.format((Number(centavos) || 0) / 100)
}

/** Forma curta para KPIs e eixos: 52570000000 → 'R$ 525,7 mi' */
export function brlCurto(centavos: number | null | undefined): string {
  const reais = (Number(centavos) || 0) / 100
  const abs = Math.abs(reais)
  if (abs >= 1e9)
    return `R$ ${(reais / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} bi`
  if (abs >= 1e6)
    return `R$ ${(reais / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (abs >= 1e3)
    return `R$ ${(reais / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
  return brl(centavos)
}

/** 1234 → '1.234' */
export function num(valor: number | null | undefined): string {
  return INTEIRO.format(Number(valor) || 0)
}

/** 2.78 → '2,78%' */
export function pct(valor: number | null | undefined, casas = 2): string {
  return `${(Number(valor) || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })}%`
}

/**
 * '2026-07-20' → '20/07/2026'.
 * Data pura (DATE) é lida como está. Timestamp ('2026-07-20T23:30:00Z') é
 * convertido para o dia de São Paulo — cortar os 10 primeiros caracteres
 * mostraria o dia de UTC, que depois das 21h no Brasil já é amanhã.
 */
export function data(iso: string | null | undefined): string {
  if (!iso) return '—'
  const texto = String(iso)
  if (texto.length > 10) {
    const dt = new Date(texto)
    if (!Number.isNaN(dt.getTime())) return dataLocal(dt)
  }
  const [a, m, d] = texto.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** '2026-07-20' → '20/jul' */
export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return ''
  const [, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${MESES[Number(m) - 1]}`
}

/**
 * '2026-07-20T14:30:00Z' → '20/07 11:30' (horário de São Paulo).
 * Sempre em SP, esteja rodando no servidor (UTC) ou no navegador: é o horário
 * da operação, e o mesmo carimbo precisa ler igual no trace e na tela.
 */
export function dataHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return '—'
  return dataHoraLocal(dt)
}

/** 87.5 → '87,5 m²' */
export function area(m2: number | null | undefined): string {
  if (m2 == null) return '—'
  return `${Number(m2).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m²`
}

/**
 * CPF nunca aparece inteiro na UI (PRD 6.2) — so os 4 ultimos digitos.
 *
 * CPF tem 11 digitos no formato XXX.XXX.XXX-YY, entao os 4 ultimos sao dois do
 * terceiro grupo mais os dois verificadores: '5594' vira '***.***.*55-94'.
 * A versao anterior punha tres digitos depois do hifen ('**5-594'), o que nao
 * corresponde a nenhum CPF e fazia a pessoa duvidar do proprio cadastro.
 */
export function cpfMascarado(last4: string | null | undefined): string {
  if (!last4) return '—'
  const d = String(last4).replace(/\D/g, '').slice(-4).padStart(4, '0')
  return `***.***.*${d.slice(0, 2)}-${d.slice(2)}`
}

/** '5511987654321' → '(11) 98765-4321' */
export function telefone(raw: string | null | undefined): string {
  if (!raw) return '—'
  const d = String(raw).replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return raw
}
