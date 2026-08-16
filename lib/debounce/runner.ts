// ==========================================
// Executor da janela de debounce.
//
// Espera a janela de silêncio, junta o que chegou e chama o pipeline UMA vez.
// Roda dentro do `after()` do webhook: a resposta HTTP já foi devolvida ao
// Z-API, então a espera não segura o webhook nem provoca reenvio.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { processMessage } from '@/lib/pipeline/process-message'
import {
  MAX_WAIT_SECONDS,
  debounceSegundos,
  drainQueue,
  shouldExtendWindow,
} from '@/lib/debounce/queue'
import type { Channel } from '@/lib/channels/types'
import type { Contact } from '@/lib/types/domain'

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Espera a rajada terminar e processa tudo de uma vez.
 *
 * A janela se estende enquanto chegarem mensagens novas, até MAX_WAIT_SECONDS —
 * sem esse teto, alguém digitando sem parar adiaria a resposta indefinidamente e
 * ainda estouraria o maxDuration da função.
 */
export async function aguardarEProcessar(channel: Channel, contactId: string): Promise<void> {
  const limite = Date.now() + MAX_WAIT_SECONDS * 1000
  /* Lido UMA vez no início: reler a cada extensão faria a janela mudar de
     tamanho no meio da própria espera se alguém salvasse a configuração
     naquele instante. */
  const janelaMs = (await debounceSegundos()) * 1000

  await dormir(janelaMs)

  while (Date.now() < limite && (await shouldExtendWindow(channel, contactId))) {
    const restante = Math.min(janelaMs, limite - Date.now())
    if (restante <= 0) break
    await dormir(restante)
  }

  const fila = await drainQueue(channel, contactId)
  if (fila.length === 0) return

  /* As mensagens da rajada viram um bloco só. Quebra de linha em vez de espaço
     porque cada uma foi enviada como mensagem separada — juntar tudo numa linha
     confundiria "Oi" + "quero alugar" com uma frase só. */
  const conteudo = fila.map((m) => m.content).join('\n')
  const ultima = fila[fila.length - 1]

  const supabase = createAdminClient()
  const { data: contato } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .single()

  if (!contato) {
    console.error('[debounce] contato sumiu antes do processamento:', contactId)
    return
  }

  console.log(
    `[debounce] processando ${fila.length} mensagem(ns) de ${contactId} após a janela`
  )

  await processMessage({
    channel,
    replyAddress: ultima.replyAddress,
    message: conteudo,
    contact: contato as Contact,
    conversationId: ultima.conversationId,
  })
}
