import type { AgentName } from './domain'

// ==========================================
// Tipos do sistema multiagente
// ==========================================

/** O orquestrador tambem pode devolver 'despedida', que e template e nao roda LLM. */
export type RoutableAgent = AgentName | 'despedida'

export interface ChatHistoryMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at?: string
}

export interface OrchestratorResult {
  agent: RoutableAgent
  reasoning: string
}

export interface ToolCallTrace {
  name: string
  arguments: Record<string, unknown>
  result: unknown
  duration_ms: number
}

export interface AgentResponse {
  content: string
  tokensUsed: number
  toolsUsed: string[]
  waDisplayName?: string | null
  trace?: {
    model: string
    toolCalls: ToolCallTrace[]
    promptMessages: { role: string; content: string | null }[]
    rawResponse: string
    durationMs: number
  }
}
