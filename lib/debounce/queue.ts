// ==========================================
// Fila de debounce — acumula mensagens de entrada por (canal, contactId) para o
// pipeline responder UMA vez a uma rajada, em vez de uma vez por mensagem.
// Quem digita "oi", "tudo bem?", "queria ver um apê" em três mensagens seguidas
// recebe uma resposta que considera as três.
//
// Usada por Z-API e Meta. O widget é síncrono e não passa por aqui.
//
// Duas decisões de desenho:
//   * Janela de 20s, não 8s — é o número da seção 3.3 do PRD (resposta ao lead
//     em até 45s, com debounce de 20s).
//   * O agendamento do callback não usa QStash. Quem espera a janela é o
//     `after()` do Next dentro do próprio webhook (ver app/api/webhook/zapi).
//     Uma dependência externa a menos para configurar e para cair.
// ==========================================

import { redis } from '@/lib/redis/client'
import type { Channel } from '@/lib/channels/types'
import { getConfiguracoes } from '@/lib/config/app'

/** Janela de silêncio após a última mensagem antes de processar (PRD 3.3).
 *
 * Sai das Configurações (`debounce_segundos`). O fallback de 20s existe porque
 * isto roda no caminho de uma mensagem de cliente: se a leitura da configuração
 * falhar, agrupar com o padrão é melhor do que derrubar o atendimento. */
export async function debounceSegundos(): Promise<number> {
  return (await getConfiguracoes()).debounce_segundos
}

/** Teto de espera total, contando extensões. Precisa caber no maxDuration
    de 60s da função, junto com o tempo do pipeline (~11s medidos). */
export const MAX_WAIT_SECONDS = 40

/* TTL de segurança nas chaves: se o processamento nunca rodar (função morta,
   deploy no meio), as chaves expiram sozinhas e uma mensagem futura não fica
   presa atrás de uma fila fantasma. */
const SAFETY_TTL_SECONDS = 300

export interface QueuedMessage {
  content: string
  contactId: string
  conversationId: string
  channel: Channel
  replyAddress: string
  enqueuedAt: number
}

export interface EnqueueResult {
  /** true só para quem abriu a janela — é quem deve esperar e processar */
  isFirst: boolean
  size: number
}

export async function enqueueMessage(msg: QueuedMessage): Promise<EnqueueResult> {
  const qKey = queueKey(msg.channel, msg.contactId)
  const lastKey = lastMsgKey(msg.channel, msg.contactId)
  const schedKey = scheduledKey(msg.channel, msg.contactId)

  const size = await redis.rpush(qKey, JSON.stringify(msg))
  await redis.expire(qKey, SAFETY_TTL_SECONDS)
  await redis.set(lastKey, String(Date.now()), { ex: SAFETY_TTL_SECONDS })

  // Só quem consegue o lock abre o ciclo; as demais mensagens da mesma rajada
  // apenas entram na fila e deixam o líder processar.
  const acquired = await redis.set(schedKey, '1', { nx: true, ex: SAFETY_TTL_SECONDS })

  return { isFirst: acquired === 'OK', size }
}

/** Chegou mensagem nova dentro da janela? Então esperar mais um pouco. */
export async function shouldExtendWindow(channel: Channel, contactId: string): Promise<boolean> {
  const last = await redis.get(lastMsgKey(channel, contactId))
  if (last == null) return false
  const lastMs = typeof last === 'number' ? last : Number(last)
  if (!Number.isFinite(lastMs)) return false
  return Date.now() - lastMs < (await debounceSegundos()) * 1000
}

/** Esvazia a fila e devolve tudo que estava acumulado. */
export async function drainQueue(channel: Channel, contactId: string): Promise<QueuedMessage[]> {
  const qKey = queueKey(channel, contactId)
  const raw = await redis.lrange<string>(qKey, 0, -1)
  await redis.del(qKey)
  await redis.del(lastMsgKey(channel, contactId))
  await redis.del(scheduledKey(channel, contactId))

  if (!raw || raw.length === 0) return []
  return raw
    .map((item) => {
      if (typeof item === 'string') {
        try {
          return JSON.parse(item) as QueuedMessage
        } catch {
          return null
        }
      }
      return item as QueuedMessage
    })
    .filter((x): x is QueuedMessage => x !== null)
}

/** Solta os locks sem drenar — usado quando decidimos processar na hora. */
export async function clearQueueLocks(channel: Channel, contactId: string): Promise<void> {
  await redis.del(scheduledKey(channel, contactId))
  await redis.del(lastMsgKey(channel, contactId))
  await redis.del(queueKey(channel, contactId))
}

function queueKey(ch: Channel, cid: string) {
  return `debounce:queue:${ch}:${cid}`
}
function lastMsgKey(ch: Channel, cid: string) {
  return `debounce:last:${ch}:${cid}`
}
function scheduledKey(ch: Channel, cid: string) {
  return `debounce:sched:${ch}:${cid}`
}
