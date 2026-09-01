// ==========================================
// Abstracao de canal — tipos comuns a Z-API, Meta Cloud API e Widget web.
// ==========================================

// Canais de mensagem — transporte de conversa com o cliente
export type Channel = 'zapi' | 'meta' | 'widget'

// Integracoes guardadas em channel_configs que nao sao canal de mensagem.
// 'asaas' (cobranca) entra na lista de integracoes — mesmo motivo de estar
// nessa tabela: o segredo do webhook precisa de armazenamento cifrado.
export type IntegrationChannel = Channel | 'asaas' | 'crm'

export type IncomingMessageType = 'text' | 'image' | 'audio' | 'document'

/**
 * Mensagem de entrada normalizada — emitida por todo adapter de canal e
 * consumida pelo pipeline unificado.
 */
export interface IncomingMessage {
  channel: Channel
  /** Identificador estavel dentro do canal (phone_key para zapi/meta, session_token para widget) */
  externalId: string
  /** Telefone de exibicao (so zapi/meta) — opcional para o widget */
  phone?: string
  /** Nome do visitante, quando o canal informa */
  senderName?: string
  messageId: string
  messageType: IncomingMessageType
  content: string
  mediaUrl?: string
  timestamp: string
}

/**
 * Payload de saida — o que os agentes produzem. O adapter do canal e quem sabe
 * como devolver isso ao usuario.
 */
export interface OutgoingMessage {
  contactId: string
  externalId: string
  text: string
  /** Prefixo de nome de exibicao (ex: "Alice - LoveHome") — o adapter decide como renderizar */
  displayName?: string | null
}

/**
 * Contrato do adapter — uma implementacao por canal. Mantem o pipeline
 * ignorante dos detalhes de transporte.
 */
export interface ChannelAdapter {
  channel: Channel
  send(msg: OutgoingMessage): Promise<void>
}
