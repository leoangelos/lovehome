import { createAdminClient } from '@/lib/supabase/admin'
import { listarCampos } from '@/lib/registrations/campos'
import { formatarResposta } from '@/lib/registrations/campos-formato'

/* Leituras da tela de Conversas (PRD 17.1).
 *
 * Nenhuma consulta seleciona cpf_hash ou cpf_encrypted — só cpf_last4.
 */

export type CanalConversa = 'zapi' | 'meta' | 'widget'

export interface ConversaLinha {
  id: string
  channel: CanalConversa
  status: string
  agent: string | null
  last_message_at: string | null
  human_takeover: boolean
  taken_by: string | null
  contato_id: string
  contato_nome: string | null
  contato_telefone: string | null
  funnel_stage: string
  corretor: string | null
  ultima_mensagem: string | null
  ultima_de: string | null
  nao_respondida: boolean
}

/* Reexportado de lib/ui/rotulos: componente de cliente não pode importar deste
   arquivo, que carrega createAdminClient. */
export { ROTULO_CANAL } from '@/lib/ui/rotulos'

export async function listarConversas(brokerId?: string | null): Promise<ConversaLinha[]> {
  const supabase = createAdminClient()

  const consulta = supabase
    .from('conversations')
    .select(
      `id, channel, status, agent, last_message_at, human_takeover, taken_by, contact_id,
       contacts ( name, phone, funnel_stage, assigned_broker_id, brokers ( name ) )`
    )
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(200)

  const { data, error } = await consulta
  if (error) throw new Error(`Falha ao listar conversas: ${error.message}`)

  let linhas = (data ?? []).map((c) => {
    const contato = c.contacts as unknown as {
      name: string | null
      phone: string | null
      funnel_stage: string
      assigned_broker_id: string | null
      brokers: { name: string } | null
    } | null

    return {
      id: c.id,
      channel: c.channel as CanalConversa,
      status: c.status,
      agent: c.agent,
      last_message_at: c.last_message_at,
      human_takeover: c.human_takeover,
      taken_by: c.taken_by,
      contato_id: c.contact_id,
      contato_nome: contato?.name ?? null,
      contato_telefone: contato?.phone ?? null,
      funnel_stage: contato?.funnel_stage ?? 'novo',
      corretor: contato?.brokers?.name ?? null,
      _broker: contato?.assigned_broker_id ?? null,
      ultima_mensagem: null as string | null,
      ultima_de: null as string | null,
      nao_respondida: false,
    }
  })

  /* Recorte por carteira em memória: `assigned_broker_id` está no `contacts`
     relacionado, e o PostgREST não filtra por coluna de tabela aninhada num
     select como este. */
  if (brokerId) linhas = linhas.filter((l) => l._broker === brokerId)

  /* Última mensagem de cada conversa numa consulta só. Uma por linha
     multiplicaria ida e volta numa tela que lista 200. */
  const ids = linhas.map((l) => l.id)
  if (ids.length) {
    const { data: mensagens } = await supabase
      .from('messages')
      .select('conversation_id, content, role, created_at')
      .in('conversation_id', ids)
      .order('created_at', { ascending: false })
      .limit(600)

    const vistas = new Set<string>()
    for (const m of mensagens ?? []) {
      if (vistas.has(m.conversation_id)) continue
      vistas.add(m.conversation_id)
      const linha = linhas.find((l) => l.id === m.conversation_id)
      if (linha) {
        linha.ultima_mensagem = m.content.slice(0, 140)
        linha.ultima_de = m.role
        /* "Não respondida" = a última palavra foi do cliente. É o que faz a
           tela servir para trabalhar em vez de só listar. */
        linha.nao_respondida = m.role === 'user'
      }
    }
  }

  return linhas.map(({ _broker, ...resto }) => {
    void _broker
    return resto
  })
}

export interface MensagemLinha {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  media_type: string | null
  media_url: string | null
  agent: string | null
  created_at: string
}

export interface ChamadaTool {
  name: string
  arguments: Record<string, unknown>
  result: unknown
  duration_ms: number
}

/** O caminho que a IA percorreu até produzir UMA resposta (PRD 12, observabilidade). */
export interface TraceLinha {
  message_id: string | null
  routed_to: string | null
  /** Por que o Orquestrador escolheu este agente — em texto, vindo do modelo. */
  routing_reasoning: string | null
  routing_model: string | null
  agent: string
  agent_model: string | null
  agent_tokens: number | null
  tool_calls: ChamadaTool[]
  prompt_messages: { role: string; content: string | null }[] | null
  raw_response: string | null
  total_duration_ms: number | null
  created_at: string
}

export interface ConversaDetalhe {
  id: string
  channel: CanalConversa
  status: string
  agent: string | null
  human_takeover: boolean
  taken_by: string | null
  taken_at: string | null
  takeover_expires_at: string | null
  contato: {
    id: string
    nome: string | null
    telefone: string | null
    funnel_stage: string
    intent: string | null
    registration_status: string
    cpf_last4: string | null
    nome_cadastro: string | null
    corretor: string | null
    broker_id: string | null
    /** Respostas dos campos configuráveis (PRD 6.5), já com rótulo. */
    extras: { rotulo: string; valor: string }[]
  }
  mensagens: MensagemLinha[]
  /** Chaveado por message_id: a tela abre o trace embaixo da resposta que ele gerou. */
  traces: Record<string, TraceLinha>
}

export async function buscarConversa(id: string): Promise<ConversaDetalhe | null> {
  const supabase = createAdminClient()

  const { data: conversa } = await supabase
    .from('conversations')
    .select(
      `id, channel, status, agent, human_takeover, taken_by, taken_at, takeover_expires_at,
       contact_id,
       contacts ( id, name, phone, funnel_stage, intent, registration_status,
                  assigned_broker_id, brokers ( name ), registrations ( full_name, cpf_last4, extra ) )`
    )
    .eq('id', id)
    .maybeSingle()

  if (!conversa) return null

  const contato = conversa.contacts as unknown as {
    id: string
    name: string | null
    phone: string | null
    funnel_stage: string
    intent: string | null
    registration_status: string
    assigned_broker_id: string | null
    brokers: { name: string } | null
    registrations: { full_name: string; cpf_last4: string; extra: Record<string, unknown> | null } | null
  } | null

  const { data: mensagens } = await supabase
    .from('messages')
    .select('id, role, content, media_type, media_url, agent, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(500)

  /* Traces da conversa inteira numa consulta só. `prompt_messages` e
     `raw_response` são grandes; o limite de 200 evita puxar megabytes numa
     conversa longa, e o que passar disso simplesmente não terá o "porquê"
     visível — o histórico de mensagens continua completo. */
  const { data: traces } = await supabase
    .from('message_traces')
    .select(
      'message_id, routed_to, routing_reasoning, routing_model, agent, agent_model, agent_tokens, tool_calls, prompt_messages, raw_response, total_duration_ms, created_at'
    )
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(200)

  const porMensagem: Record<string, TraceLinha> = {}
  for (const t of traces ?? []) {
    if (t.message_id) porMensagem[t.message_id] = t as unknown as TraceLinha
  }

  return {
    id: conversa.id,
    channel: conversa.channel as CanalConversa,
    status: conversa.status,
    agent: conversa.agent,
    human_takeover: conversa.human_takeover,
    taken_by: conversa.taken_by,
    taken_at: conversa.taken_at,
    takeover_expires_at: conversa.takeover_expires_at,
    contato: {
      id: conversa.contact_id,
      nome: contato?.name ?? null,
      telefone: contato?.phone ?? null,
      funnel_stage: contato?.funnel_stage ?? 'novo',
      intent: contato?.intent ?? null,
      registration_status: contato?.registration_status ?? 'none',
      cpf_last4: contato?.registrations?.cpf_last4 ?? null,
      nome_cadastro: contato?.registrations?.full_name ?? null,
      corretor: contato?.brokers?.name ?? null,
      broker_id: contato?.assigned_broker_id ?? null,
      extras: await rotularExtras(contato?.registrations?.extra ?? null),
    },
    mensagens: (mensagens ?? []) as MensagemLinha[],
    traces: porMensagem,
  }
}

/**
 * Traduz `registrations.extra` (chave crua) para o que a tela mostra.
 *
 * O rótulo vem de `form_fields`, e é por isso que apagar a definição de um
 * campo já respondido é recusado em lib/registrations/campos.ts: sem ela, esta
 * função não teria como dizer o que `renda_mensal: 8000` significa.
 */
async function rotularExtras(
  extra: Record<string, unknown> | null
): Promise<{ rotulo: string; valor: string }[]> {
  if (!extra || Object.keys(extra).length === 0) return []

  const campos = await listarCampos('cadastro')
  const saida: { rotulo: string; valor: string }[] = []

  for (const campo of campos) {
    if (!(campo.chave in extra)) continue
    saida.push({ rotulo: campo.rotulo, valor: formatarResposta(campo, extra[campo.chave]) })
  }

  return saida
}
