// ==========================================
// Meta WhatsApp Cloud API adapter
// https://developers.facebook.com/docs/whatsapp/cloud-api
// ==========================================

import { extractPhoneKey } from '@/lib/utils/phone'
import { getChannelCredentials } from './config'
import type { ChannelAdapter, IncomingMessage, OutgoingMessage } from './types'

const GRAPH_VERSION = 'v21.0'
const MAX_PARTS = 6
const SEND_DELAY_MS = 3000

/**
 * Send a single text message via Meta Cloud API.
 * `to` must be the wa_id (phone digits, international format, no +).
 */
async function metaSendText(to: string, text: string): Promise<void> {
  const creds = await getChannelCredentials('meta')
  if (!creds.phoneId || !creds.accessToken) {
    throw new Error('Meta WhatsApp credentials not configured')
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${creds.phoneId}/messages`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text, preview_url: false },
    }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    console.error('[Meta sender] Graph API error:', res.status, errBody)
    throw new Error(`Meta send failed: ${res.status}`)
  }
}

/**
 * Fractioned send (same UX as Z-API): split by paragraphs, delay between parts.
 */
async function metaSendFractioned(to: string, fullText: string): Promise<void> {
  const parts = fullText.split('\n\n').map(p => p.trim()).filter(Boolean)
  const toSend = parts.length > MAX_PARTS ? mergeParts(parts, MAX_PARTS) : parts
  for (let i = 0; i < toSend.length; i++) {
    await metaSendText(to, toSend[i])
    if (i < toSend.length - 1) await sleep(SEND_DELAY_MS)
  }
}

function mergeParts(parts: string[], maxParts: number): string[] {
  if (parts.length <= maxParts) return parts
  const merged: string[] = []
  const perGroup = Math.ceil(parts.length / maxParts)
  for (let i = 0; i < parts.length; i += perGroup) {
    merged.push(parts.slice(i, i + perGroup).join('\n\n'))
  }
  return merged.slice(0, maxParts)
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export const metaAdapter: ChannelAdapter = {
  channel: 'meta',
  async send(msg: OutgoingMessage) {
    if (!msg.externalId) throw new Error('Meta send requires externalId (wa_id)')
    const text = msg.displayName
      ? `*${msg.displayName}*:\n${msg.text}`
      : msg.text
    await metaSendFractioned(msg.externalId, text)
  },
}

// ==========================================
// Meta webhook payload parsing
// ==========================================

interface MetaWebhookValue {
  messaging_product?: string
  metadata?: { phone_number_id?: string }
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>
  messages?: Array<MetaWebhookMessage>
}

interface MetaWebhookMessage {
  id: string
  from: string
  timestamp: string
  type: 'text' | 'image' | 'audio' | 'document' | 'video' | 'sticker' | string
  text?: { body: string }
  image?: { id: string; mime_type?: string; caption?: string }
  audio?: { id: string; mime_type?: string }
  document?: { id: string; mime_type?: string; filename?: string; caption?: string }
}

export interface MetaWebhookPayload {
  object?: string
  entry?: Array<{
    id?: string
    changes?: Array<{
      field?: string
      value?: MetaWebhookValue
    }>
  }>
}

/**
 * Resolve a Meta media ID to its temporary download URL.
 * NOTE: this URL is NOT public — it can only be fetched with the same
 * `Authorization: Bearer <token>` header (see downloadMetaMedia). Passing it
 * straight to OpenAI/Whisper fails with 401. Prefer downloadMetaMedia.
 */
export async function resolveMetaMediaUrl(mediaId: string): Promise<string | null> {
  const creds = await getChannelCredentials('meta')
  if (!creds.accessToken) return null

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${creds.accessToken}` },
  })
  if (!res.ok) return null
  const body = (await res.json()) as { url?: string }
  return body.url || null
}

/**
 * Download the actual bytes of a Meta media file.
 *
 * Meta media is a two-step, authenticated flow: (1) resolve the media ID to a
 * temporary lookaside URL, (2) fetch that URL WITH the bearer token. Both steps
 * require auth — the lookaside URL is not publicly accessible, which is why
 * handing it to OpenAI's vision/Whisper endpoints (which fetch it anonymously)
 * always failed. Download here and pass the bytes onward instead.
 */
export async function downloadMetaMedia(
  mediaId: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const creds = await getChannelCredentials('meta')
  if (!creds.accessToken) return null

  const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${creds.accessToken}` },
  })
  if (!metaRes.ok) {
    console.error('[Meta media] Failed to resolve media ID:', mediaId, metaRes.status)
    return null
  }
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string }
  if (!meta.url) return null

  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${creds.accessToken}` },
  })
  if (!fileRes.ok) {
    console.error('[Meta media] Failed to download media bytes:', mediaId, fileRes.status)
    return null
  }

  const buffer = Buffer.from(await fileRes.arrayBuffer())
  const contentType =
    meta.mime_type?.split(';')[0].trim() ||
    fileRes.headers.get('content-type')?.split(';')[0].trim() ||
    'application/octet-stream'

  return { buffer, contentType }
}

/**
 * Extract the first (or only) message from a Meta webhook payload.
 * Meta can batch multiple messages — we flatten them.
 */
export function parseMetaIncoming(payload: MetaWebhookPayload): IncomingMessage[] {
  const out: IncomingMessage[] = []
  const entries = payload.entry || []

  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value
      if (!value?.messages) continue

      const contactName = value.contacts?.[0]?.profile?.name

      for (const m of value.messages) {
        const phone = m.from.replace(/\D/g, '')
        const phoneKey = extractPhoneKey(phone)

        let type: 'text' | 'image' | 'audio' | 'document' = 'text'
        let content = ''
        let mediaUrl: string | undefined

        if (m.type === 'text' && m.text?.body) {
          content = m.text.body
        } else if (m.type === 'image' && m.image) {
          type = 'image'
          content = m.image.caption || '[Imagem recebida]'
          mediaUrl = m.image.id // id, nao URL — ver downloadMetaMedia
        } else if (m.type === 'audio' && m.audio) {
          type = 'audio'
          content = '[Áudio recebido]'
          mediaUrl = m.audio.id
        } else if (m.type === 'document' && m.document) {
          /* Documento nao era suportado aqui. E o canal pelo qual o contrato
             assinado volta (PRD 15.3, passo 3) e pelo qual chegam RG e
             comprovante — descartar em silencio perderia justamente o arquivo
             que a operacao esta esperando. */
          type = 'document'
          content = m.document.filename || m.document.caption || '[Documento recebido]'
          mediaUrl = m.document.id
        } else {
          // Ignorados de proposito: sticker, video, localizacao, contato.
          continue
        }

        out.push({
          channel: 'meta',
          externalId: phoneKey,
          phone,
          senderName: contactName,
          messageId: m.id,
          messageType: type,
          content,
          mediaUrl,
          timestamp: new Date(Number(m.timestamp) * 1000).toISOString(),
        })
      }
    }
  }

  return out
}
