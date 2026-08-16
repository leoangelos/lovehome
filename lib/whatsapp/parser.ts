// ==========================================
// WhatsApp Parser — parses Z-API payloads
// ==========================================

import type { ZApiWebhookPayload, ParsedMessage } from '@/lib/types/whatsapp'
import { extractPhoneKey } from '@/lib/utils/phone'

/**
 * Parse a Z-API webhook payload into a standardized message
 */
export function parseZApiPayload(payload: ZApiWebhookPayload): ParsedMessage | null {
  // Skip group messages
  if (payload.isGroup) return null
  
  // Skip messages sent by us
  if (payload.fromMe) return null

  // Skip newsletter messages
  if (payload.isNewsletter) return null

  // Determine message type and content
  let messageType: 'text' | 'image' | 'audio' | 'document' = 'text'
  let content = ''
  let mediaUrl: string | undefined

  if (payload.text?.message) {
    messageType = 'text'
    content = payload.text.message
  } else if (payload.image) {
    messageType = 'image'
    content = payload.image.caption || '[Imagem recebida]'
    mediaUrl = payload.image.imageUrl
  } else if (payload.audio) {
    messageType = 'audio'
    content = '[Áudio recebido]'
    mediaUrl = payload.audio.audioUrl
  } else if (payload.document) {
    messageType = 'document'
    content = payload.document.title || '[Documento recebido]'
    mediaUrl = payload.document.documentUrl
  } else {
    // Unknown message type
    return null
  }

  const phone = payload.phone.replace(/\D/g, '')

  return {
    phone,
    phoneKey: extractPhoneKey(phone),
    senderName: payload.senderName || payload.chatName || 'Desconhecido',
    /* Mantém 'document' em vez de rebaixar para 'text'.
       O PDF é peça do fluxo — é
       assim que chega o contrato assinado (PRD 15.3) e o documento do cliente
       (PRD 12.5). Rebaixar perderia o media_url e o tipo, e a informação não
       voltaria depois. O handler de documento em si é Marco 2; até lá o dado
       fica guardado do jeito certo. */
    messageType,
    content,
    mediaUrl,
    isGroup: payload.isGroup,
    fromMe: payload.fromMe,
    messageId: payload.messageId,
    timestamp: payload.momment || new Date().toISOString(),
  }
}
