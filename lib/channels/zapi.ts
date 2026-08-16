// ==========================================
// Z-API adapter — wraps the existing Z-API sender
// ==========================================

import { sendFractioned } from '@/lib/whatsapp/sender'
import { parseZApiPayload } from '@/lib/whatsapp/parser'
import type { ZApiWebhookPayload } from '@/lib/types/whatsapp'
import type { ChannelAdapter, IncomingMessage, OutgoingMessage } from './types'

export const zapiAdapter: ChannelAdapter = {
  channel: 'zapi',
  async send(msg: OutgoingMessage) {
    if (!msg.externalId) throw new Error('Z-API send requires externalId (phone)')
    const text = msg.displayName
      ? `*${msg.displayName}*:\n${msg.text}`
      : msg.text
    // externalId is the phone (digits-only, international format)
    await sendFractioned(msg.externalId, text)
  },
}

/**
 * Parse a Z-API webhook body into the unified IncomingMessage shape.
 */
export function parseZApiIncoming(payload: ZApiWebhookPayload): IncomingMessage | null {
  const parsed = parseZApiPayload(payload)
  if (!parsed) return null

  return {
    channel: 'zapi',
    externalId: parsed.phoneKey,
    phone: parsed.phone,
    senderName: parsed.senderName,
    messageId: parsed.messageId,
    messageType: parsed.messageType,
    content: parsed.content,
    mediaUrl: parsed.mediaUrl,
    timestamp: parsed.timestamp,
  }
}
