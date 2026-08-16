// ==========================================
// Registro de canais — roteia OutgoingMessage para o adapter certo.
// ==========================================

import { zapiAdapter } from './zapi'
import { metaAdapter } from './meta'
import { widgetAdapter } from './widget'
import type { Channel, ChannelAdapter, OutgoingMessage } from './types'

const adapters: Record<Channel, ChannelAdapter> = {
  zapi: zapiAdapter,
  meta: metaAdapter,
  widget: widgetAdapter,
}

export function getAdapter(channel: Channel): ChannelAdapter {
  const adapter = adapters[channel]
  if (!adapter) throw new Error(`Canal desconhecido: ${channel}`)
  return adapter
}

export async function dispatchOutgoing(channel: Channel, msg: OutgoingMessage): Promise<void> {
  await getAdapter(channel).send(msg)
}

export type { Channel, ChannelAdapter, IncomingMessage, OutgoingMessage } from './types'
