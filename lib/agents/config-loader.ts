// ==========================================
// Carregador de config de agente — le prompt e parametros de agent_configs,
// com fallback para o default embutido no codigo. Cache em memoria de 5 min.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'

interface AgentConfig {
  system_prompt: string
  model: string
  temperature: number
  top_p: number | null
  max_tokens: number | null
  frequency_penalty: number | null
  presence_penalty: number | null
  is_active: boolean
  wa_display_name: string | null
}

let cache: Record<string, AgentConfig> = {}
let cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000

export async function loadAgentConfig(
  agentKey: string,
  defaultPrompt: string,
  defaultModel: string = 'gpt-4o',
  defaultTemp: number = 0.7
): Promise<AgentConfig> {
  const now = Date.now()

  if (cache[agentKey] && now - cacheTime < CACHE_TTL) {
    return cache[agentKey]
  }

  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('agent_configs')
      .select(
        'system_prompt, model, temperature, top_p, max_tokens, frequency_penalty, presence_penalty, is_active, wa_display_name'
      )
      .eq('agent_key', agentKey)
      .maybeSingle()

    if (data) {
      const config: AgentConfig = {
        system_prompt: data.system_prompt,
        model: data.model || defaultModel,
        temperature: data.temperature ?? defaultTemp,
        top_p: data.top_p ?? null,
        max_tokens: data.max_tokens ?? null,
        frequency_penalty: data.frequency_penalty ?? null,
        presence_penalty: data.presence_penalty ?? null,
        is_active: data.is_active ?? true,
        wa_display_name: data.wa_display_name ?? null,
      }
      cache[agentKey] = config
      cacheTime = now
      return config
    }
  } catch {
    // Banco indisponivel — segue com o default
  }

  return {
    system_prompt: defaultPrompt,
    model: defaultModel,
    temperature: defaultTemp,
    top_p: null,
    max_tokens: null,
    frequency_penalty: null,
    presence_penalty: null,
    is_active: true,
    wa_display_name: null,
  }
}

/** Descarta o cache. Chamar depois que o painel salva um prompt novo. */
export function invalidateAgentCache() {
  cache = {}
  cacheTime = 0
}
