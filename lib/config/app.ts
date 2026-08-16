// ==========================================
// Configurações da aplicação — leitura, cache e gravação.
//
// A regra que sustenta esta tela: TODO campo aqui tem consumidor. Configuração
// que a tela grava e ninguém lê é pior do que valor fixo no código, porque cria
// a impressão de que mexer nela muda alguma coisa. `check:configuracoes` roda
// os consumidores de verdade e confere que o valor novo pegou.
//
// Cache de 60s, mais curto que o de canais (5min): quem ajusta o horário de
// atendimento costuma testar em seguida, e cinco minutos de espera parecem
// defeito. O cron de follow-up roda a cada hora, então 60s não custa nada nele.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'

export interface Configuracoes {
  nome_fantasia: string
  whatsapp_numero: string | null
  email_contato: string | null
  endereco: string | null
  creci: string | null

  followup_ativo: boolean
  followup_horas: number[]
  followup_hora_inicio: number
  followup_hora_fim: number
  followup_max_por_execucao: number

  takeover_horas: number
  debounce_segundos: number

  atualizado_em: string | null
}

/* Espelham os DEFAULT da migration 028. Existem para o sistema continuar de pé
   se o banco estiver fora do ar no meio de uma conversa — melhor atender com o
   padrão do que derrubar o atendimento por causa de uma configuração. */
export const PADRAO: Configuracoes = {
  nome_fantasia: 'LoveHome',
  whatsapp_numero: null,
  email_contato: null,
  endereco: null,
  creci: null,
  followup_ativo: true,
  followup_horas: [24, 72],
  followup_hora_inicio: 9,
  followup_hora_fim: 20,
  followup_max_por_execucao: 20,
  takeover_horas: 48,
  debounce_segundos: 20,
  atualizado_em: null,
}

const CACHE_MS = 60 * 1000
let cache: { dados: Configuracoes; expiraEm: number } | null = null

export async function getConfiguracoes(): Promise<Configuracoes> {
  if (cache && cache.expiraEm > Date.now()) return cache.dados

  try {
    const { data } = await createAdminClient().from('app_settings').select('*').eq('id', true).maybeSingle()

    const dados: Configuracoes = data ? { ...PADRAO, ...data } : PADRAO
    cache = { dados, expiraEm: Date.now() + CACHE_MS }
    return dados
  } catch (e) {
    console.error('[config] leitura falhou, usando o padrão:', (e as Error).message)
    return PADRAO
  }
}

export function invalidarCacheConfig() {
  cache = null
}

export type ResultadoConfig = { ok: true } | { ok: false; erro: string; status: number }

export interface EntradaConfig {
  nome_fantasia?: string
  whatsapp_numero?: string | null
  email_contato?: string | null
  endereco?: string | null
  creci?: string | null
  followup_ativo?: boolean
  followup_horas?: number[]
  followup_hora_inicio?: number
  followup_hora_fim?: number
  followup_max_por_execucao?: number
  takeover_horas?: number
  debounce_segundos?: number
}

/** Só dígitos — é o formato que o link wa.me exige. */
export function normalizarWhatsapp(valor: string | null | undefined): string | null {
  const digitos = String(valor ?? '').replace(/\D/g, '')
  if (!digitos) return null
  /* Menos de 12 dígitos não é número internacional completo (55 + DDD + 8 ou 9).
     Aceitar deixaria o botão da vitrine abrir uma conversa com ninguém. */
  if (digitos.length < 12 || digitos.length > 15) return null
  return digitos
}

export async function salvarConfiguracoes(
  entrada: EntradaConfig,
  editadoPor: { userId: string; email: string }
): Promise<ResultadoConfig> {
  const patch: Record<string, unknown> = {
    atualizado_por: editadoPor.userId,
    atualizado_em: new Date().toISOString(),
  }

  if (entrada.nome_fantasia !== undefined) {
    const nome = entrada.nome_fantasia.trim()
    if (!nome) return { ok: false, erro: 'O nome da imobiliária não pode ficar vazio.', status: 400 }
    patch.nome_fantasia = nome
  }

  if (entrada.whatsapp_numero !== undefined) {
    const bruto = String(entrada.whatsapp_numero ?? '').trim()
    if (bruto) {
      const numero = normalizarWhatsapp(bruto)
      if (!numero) {
        return {
          ok: false,
          erro: 'Número de WhatsApp inválido. Use o formato internacional com DDI e DDD (ex: 5511999998888).',
          status: 400,
        }
      }
      patch.whatsapp_numero = numero
    } else {
      patch.whatsapp_numero = null
    }
  }

  for (const campo of ['email_contato', 'endereco', 'creci'] as const) {
    if (entrada[campo] !== undefined) {
      const v = String(entrada[campo] ?? '').trim()
      patch[campo] = v || null
    }
  }

  if (entrada.followup_ativo !== undefined) patch.followup_ativo = entrada.followup_ativo

  if (entrada.followup_horas !== undefined) {
    const horas = entrada.followup_horas.filter((h) => Number.isFinite(h) && h > 0)
    if (!horas.length) {
      return { ok: false, erro: 'Informe ao menos um intervalo de follow-up.', status: 400 }
    }
    /* Ordenado e sem repetição: a posição na lista É o número da tentativa
       (`followup_count`), então lista fora de ordem faria a segunda tentativa
       sair antes da primeira. */
    patch.followup_horas = [...new Set(horas)].sort((a, b) => a - b)
  }

  const numericos: [keyof EntradaConfig, string, number, number][] = [
    ['followup_hora_inicio', 'Hora de início', 0, 23],
    ['followup_hora_fim', 'Hora de fim', 1, 24],
    ['followup_max_por_execucao', 'Máximo por execução', 1, 200],
    ['takeover_horas', 'Janela de atendimento humano', 1, 720],
    ['debounce_segundos', 'Agrupamento de mensagens', 0, 120],
  ]

  for (const [campo, rotulo, min, max] of numericos) {
    const v = entrada[campo]
    if (v === undefined) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
      return { ok: false, erro: `${rotulo}: informe um número entre ${min} e ${max}.`, status: 400 }
    }
    patch[campo] = v
  }

  /* Janela invertida deixaria o follow-up sem hora nenhuma para rodar — e o
     sintoma seria "o follow-up parou", não "a configuração está errada". O
     banco também barra, mas a mensagem daqui é a que a pessoa consegue ler. */
  const atual = await getConfiguracoes()
  const inicio = (patch.followup_hora_inicio as number) ?? atual.followup_hora_inicio
  const fim = (patch.followup_hora_fim as number) ?? atual.followup_hora_fim
  if (fim <= inicio) {
    return { ok: false, erro: 'A hora de fim precisa ser maior que a de início.', status: 400 }
  }

  const { error } = await createAdminClient().from('app_settings').update(patch).eq('id', true)

  if (error) {
    console.error('[config] gravação falhou:', error.message)
    return { ok: false, erro: 'Não foi possível salvar.', status: 500 }
  }

  invalidarCacheConfig()
  console.log(`[config] ${editadoPor.email} alterou ${Object.keys(patch).length - 2} campo(s)`)
  return { ok: true }
}
