// ==========================================
// Z-API WhatsApp types
// ==========================================

export interface ZApiWebhookPayload {
  phone: string              // sender phone number
  instanceId: string
  messageId: string
  fromMe: boolean
  momment: string            // Z-API timestamp field (their typo)
  status: string
  chatName: string
  senderPhoto: string
  senderName: string
  participantPhone: string | null
  isGroup: boolean
  isNewsletter: boolean

  // Text message
  text?: {
    message: string
  }

  // Image message
  image?: {
    imageUrl: string
    caption: string
    mimeType: string
    thumbnailUrl: string
  }

  // Audio message
  audio?: {
    audioUrl: string
    mimeType: string
  }

  // Document message
  document?: {
    documentUrl: string
    mimeType: string
    title: string
  }
}

export interface ParsedMessage {
  phone: string             // full phone with country code
  phoneKey: string          // last 8 digits for fast lookup
  senderName: string
  messageType: 'text' | 'image' | 'audio' | 'document'
  content: string           // text content or URL for media
  mediaUrl?: string
  isGroup: boolean
  fromMe: boolean
  messageId: string
  timestamp: string
}

export interface SendMessagePayload {
  phone: string
  message: string
}

export interface ZApiSendResponse {
  zapiMessageId: string
  messageId: string
  id: string
}
