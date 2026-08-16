// ==========================================
// Edição de prompt e parâmetros de agente pelo painel (PRD 12, tela §17.1).
//
// Fora da rota HTTP para ser testável sem subir sessão.
//
// Duas coisas que valem entender antes de mexer:
//
// 1. RESTAURAR O PADRÃO É APAGAR A LINHA, não copiar o texto do código para
//    dentro dela. Copiar congelaria a versão de hoje: o agente pararia de
//    acompanhar as melhorias feitas no prompt em código e ninguém perceberia,
//    porque a tela continuaria mostrando um texto plausível.
//
// 2. O CACHE É POR PROCESSO. `invalidateAgentCache()` limpa o cache da
//    instância que atendeu esta requisição. Em serverless, outras instâncias
//    seguem com a versão antiga até o TTL de 5 minutos vencer. Não é bug para
//    corrigir aqui — é a janela que quem edita precisa conhecer, e por isso a
//    tela avisa.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { invalidateAgentCache } from './config-loader'
import { AGENTES, acharAgente, MODELOS } from './registro'

export type Resultado = { ok: true } | { ok: false; erro: string; status: number }

export interface EntradaAgente {
  system_prompt?: string
  model?: string
  temperature?: number
  wa_display_name?: string | null
}

/** Piso do prompt: abaixo disso não é ajuste, é apagar o agente por engano. */
const MINIMO_PROMPT = 80

export async function salvarAgente(
  agentKey: string,
  entrada: EntradaAgente,
  editadoPor: { userId: string; email: string }
): Promise<Resultado> {
  const agente = acharAgente(agentKey)
  if (!agente) return { ok: false, erro: 'Agente desconhecido.', status: 404 }

  const prompt = entrada.system_prompt?.trim()
  if (!prompt) return { ok: false, erro: 'O prompt não pode ficar vazio.', status: 400 }

  if (prompt.length < MINIMO_PROMPT) {
    /* Prompt de três palavras não é configuração, é agente inutilizado. E o
       estrago só aparece na próxima conversa de um cliente real. */
    return {
      ok: false,
      erro: `Prompt curto demais (${prompt.length} caracteres). Isso deixaria o agente sem instrução nenhuma.`,
      status: 400,
    }
  }

  const modelo = entrada.model ?? agente.modeloPadrao
  if (!MODELOS.includes(modelo as never)) {
    return { ok: false, erro: 'Modelo não suportado.', status: 400 }
  }

  const temperatura = entrada.temperature ?? agente.temperaturaPadrao
  if (typeof temperatura !== 'number' || temperatura < 0 || temperatura > 2) {
    return { ok: false, erro: 'Temperatura precisa ficar entre 0 e 2.', status: 400 }
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('agent_configs').upsert(
    {
      agent_key: agentKey,
      display_name: agente.nome,
      description: agente.descricao,
      system_prompt: prompt,
      model: modelo,
      temperature: temperatura,
      wa_display_name: entrada.wa_display_name ?? null,
      updated_by: editadoPor.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'agent_key' }
  )

  if (error) {
    console.error('[agentes] gravação falhou:', error.message)
    return { ok: false, erro: 'Não foi possível salvar.', status: 500 }
  }

  invalidateAgentCache()
  console.log(`[agentes] ${editadoPor.email} editou o agente ${agentKey} (${prompt.length} chars)`)
  return { ok: true }
}

/** Volta ao prompt do código apagando a sobrescrita. */
export async function restaurarPadrao(
  agentKey: string,
  editadoPor: { email: string }
): Promise<Resultado> {
  if (!acharAgente(agentKey)) return { ok: false, erro: 'Agente desconhecido.', status: 404 }

  const supabase = createAdminClient()
  const { error } = await supabase.from('agent_configs').delete().eq('agent_key', agentKey)

  if (error) {
    console.error('[agentes] restauração falhou:', error.message)
    return { ok: false, erro: 'Não foi possível restaurar.', status: 500 }
  }

  invalidateAgentCache()
  console.log(`[agentes] ${editadoPor.email} restaurou o padrão de ${agentKey}`)
  return { ok: true }
}

export interface AgenteNaTela {
  key: string
  nome: string
  descricao: string
  system_prompt: string
  model: string
  temperature: number
  wa_display_name: string | null
  /** true = há sobrescrita no banco; false = está rodando o prompt do código. */
  personalizado: boolean
  atualizado_em: string | null
  prompt_padrao: string
  modelo_padrao: string
  temperatura_padrao: number
}

export async function listarAgentes(): Promise<AgenteNaTela[]> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('agent_configs')
    .select('agent_key, system_prompt, model, temperature, wa_display_name, updated_at')

  const porChave = new Map((data ?? []).map((d) => [d.agent_key, d]))

  return AGENTES.map((a) => {
    const salvo = porChave.get(a.key)
    return {
      key: a.key,
      nome: a.nome,
      descricao: a.descricao,
      system_prompt: salvo?.system_prompt ?? a.promptPadrao,
      model: salvo?.model ?? a.modeloPadrao,
      temperature: salvo?.temperature ?? a.temperaturaPadrao,
      wa_display_name: salvo?.wa_display_name ?? null,
      /* A tela precisa dizer isto em voz alta: quem abre e vê um prompt não
         tem como saber se está olhando o que roda hoje ou o padrão do código. */
      personalizado: Boolean(salvo),
      atualizado_em: salvo?.updated_at ?? null,
      prompt_padrao: a.promptPadrao,
      modelo_padrao: a.modeloPadrao,
      temperatura_padrao: a.temperaturaPadrao,
    }
  })
}
