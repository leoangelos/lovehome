// ==========================================
// Tools do Copiloto do Corretor (PRD 12.8).
//
// REGRA QUE SUSTENTA TODO O RESTO: `broker_id` NÃO é parâmetro de tool.
//
// A §12.8 escreve as tools como `get_my_agenda(broker_id, date_range)`, mas
// deixar o modelo preencher o broker_id seria entregar o escopo a ele — e uma
// alucinação, ou um "mostre a agenda do corretor X" digitado pelo próprio
// usuário, viraria leitura da carteira alheia. Aqui o escopo é LIGADO no
// servidor a partir da sessão (`criarToolsCopiloto`), e o modelo nem vê que
// existe um recorte.
//
// É a mesma lição do gate de cadastro: se a ação tem consequência, ela não pode
// depender de o modelo lembrar de fazer a coisa certa.
//
// Onde o modelo PRECISA passar um identificador (um lead, um negócio), ele
// passa um TERMO DE BUSCA, não um id — e a busca já roda dentro do escopo. Isso
// fecha o caminho de adivinhar/vazar um UUID de outra carteira, em vez de
// depender de uma checagem de posse depois do fato.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { brl, dataHora } from '@/lib/utils/format'
import { ROTULO_DOCUMENTO } from '@/lib/queries/negocios'
import { FERRAMENTAS_NEGOCIAIS } from '@/lib/agents/tools/copiloto-negocio'
import type OpenAI from 'openai'

type Tool = OpenAI.ChatCompletionTool

/** `brokerId: null` = quem enxerga a operação inteira (§9.3). */
export interface EscopoCopiloto {
  brokerId: string | null
  nome: string
  /**
   * O que este papel pode VER, pela matriz da §9.2. Decide QUAIS ferramentas
   * entram na lista enviada ao modelo.
   *
   * Filtrar por papel dentro do prompt seria pedir ao modelo que guardasse
   * segredo — e prompt não é ponto de aplicação neste projeto. Ferramenta que
   * o papel não pode usar simplesmente não existe para aquela sessão.
   */
  recursos: string[]
}

export const getMyAgendaTool: Tool = {
  type: 'function',
  function: {
    name: 'get_my_agenda',
    description: `Visitas agendadas. Use para "minha agenda", "o que tenho hoje", "visitas da semana".`,
    parameters: {
      type: 'object',
      properties: {
        periodo: {
          type: 'string',
          enum: ['hoje', 'amanha', 'semana', 'todas'],
          description: 'Janela de tempo. Use "semana" para os próximos 7 dias.',
        },
      },
      required: ['periodo'],
    },
  },
}

export const getLeadSummaryTool: Tool = {
  type: 'function',
  function: {
    name: 'get_lead_summary',
    description: `Situação de um lead: estágio no funil, o que ele procura, últimas visitas e
negócios. Passe o nome ou o telefone que a pessoa citou.`,
    parameters: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'Nome ou telefone do lead' },
      },
      required: ['busca'],
    },
  },
}

export const getPendingDocumentsTool: Tool = {
  type: 'function',
  function: {
    name: 'get_pending_documents',
    description: `Documentos aguardando conferência. Use para "o que está pendente",
"tenho documento para revisar".`,
    parameters: { type: 'object', properties: {}, required: [] },
  },
}

export const getDealStatusTool: Tool = {
  type: 'function',
  function: {
    name: 'get_deal_status',
    description: `Situação de um negócio: status, imóvel, valor, documentos recebidos e o que
falta. Passe o nome do cliente ou o código do imóvel.`,
    parameters: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'Nome do cliente ou código do imóvel (LH-1001)' },
      },
      required: ['busca'],
    },
  },
}

// ---------------------------------------------------------------------------

function inicioDoDia(offsetDias = 0): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offsetDias)
  return d.toISOString()
}

async function agenda(escopo: EscopoCopiloto, params: { periodo: string }) {
  const supabase = createAdminClient()

  let consulta = supabase
    .from('property_visits')
    .select(
      `id, scheduled_at, status, type,
       contacts ( name, phone ),
       properties ( reference_code, title, region )`
    )
    .in('status', ['agendada', 'confirmada'])
    .order('scheduled_at', { ascending: true })
    .limit(50)

  if (escopo.brokerId) consulta = consulta.eq('broker_id', escopo.brokerId)

  if (params.periodo === 'hoje') {
    consulta = consulta.gte('scheduled_at', inicioDoDia()).lt('scheduled_at', inicioDoDia(1))
  } else if (params.periodo === 'amanha') {
    consulta = consulta.gte('scheduled_at', inicioDoDia(1)).lt('scheduled_at', inicioDoDia(2))
  } else if (params.periodo === 'semana') {
    consulta = consulta.gte('scheduled_at', inicioDoDia()).lt('scheduled_at', inicioDoDia(7))
  } else {
    consulta = consulta.gte('scheduled_at', inicioDoDia())
  }

  const { data, error } = await consulta
  if (error) return { erro: error.message }

  const visitas = (data ?? []).map((v) => {
    const c = v.contacts as unknown as { name: string | null; phone: string | null } | null
    const p = v.properties as unknown as {
      reference_code: string
      title: string
      region: string
    } | null
    return {
      quando: dataHora(v.scheduled_at),
      status: v.status,
      modalidade: v.type,
      cliente: c?.name ?? 'sem nome',
      telefone: c?.phone ?? null,
      imovel: p ? `${p.reference_code} — ${p.title} (${p.region})` : null,
    }
  })

  return {
    periodo: params.periodo,
    total: visitas.length,
    visitas,
    instrucao: visitas.length
      ? 'Liste em ordem de horário, com cliente e imóvel. Seja direto — quem lê está trabalhando.'
      : 'Nenhuma visita nesse período. Diga isso em uma frase, sem enfeitar.',
  }
}

async function resumoLead(escopo: EscopoCopiloto, params: { busca: string }) {
  const supabase = createAdminClient()
  const termo = params.busca.trim()
  const soDigitos = termo.replace(/\D/g, '')

  let consulta = supabase
    .from('contacts')
    .select(
      `id, name, phone, funnel_stage, intent, registration_status, last_contact,
       assigned_broker_id, registration_id,
       registrations ( full_name, cpf_last4 ),
       lead_qualifications ( region, price_max_cents, bedrooms, urgency )`
    )
    .limit(6)

  /* O escopo entra ANTES do termo de busca. Assim "me fala do lead João" nunca
     alcança o João da carteira de outro corretor — nem por acaso, nem se o
     modelo insistir. */
  if (escopo.brokerId) consulta = consulta.eq('assigned_broker_id', escopo.brokerId)

  consulta =
    soDigitos.length >= 8
      ? consulta.ilike('phone', `%${soDigitos.slice(-8)}%`)
      : consulta.ilike('name', `%${termo}%`)

  const { data, error } = await consulta
  if (error) return { erro: error.message }

  if (!data?.length) {
    return {
      encontrado: false,
      instrucao: escopo.brokerId
        ? 'Nenhum lead da carteira dele bate com essa busca. Diga isso e peça o telefone.'
        : 'Nenhum lead bate com essa busca. Peça o telefone para localizar.',
    }
  }

  if (data.length > 1) {
    return {
      varios: data.map((c) => ({ nome: c.name, telefone: c.phone, estagio: c.funnel_stage })),
      instrucao: 'Mais de um lead bate. Liste e pergunte qual deles.',
    }
  }

  const lead = data[0]
  const cadastro = lead.registrations as unknown as {
    full_name: string
    cpf_last4: string
  } | null

  /* Visita pendura no CONTATO; negócio pendura no CADASTRO. São as duas camadas
     de identidade da §6 — confundi-las devolve lista vazia em silêncio, que na
     tela parece "esse lead não tem negócio". */
  const [{ data: visitas }, { data: negocios }] = await Promise.all([
    supabase
      .from('property_visits')
      .select('scheduled_at, status, properties ( reference_code, title )')
      .eq('contact_id', lead.id)
      .order('scheduled_at', { ascending: false })
      .limit(5),
    lead.registration_id
      ? supabase
          .from('deals')
          .select(
            'id, deal_type, status, rent_price_cents, sale_price_cents, properties ( reference_code )'
          )
          .eq('client_registration_id', lead.registration_id)
          .limit(5)
      : Promise.resolve({ data: [] as never[] }),
  ])

  /* lead_qualifications tem UNIQUE(contact_id), mas o PostgREST devolve array
     porque a FK aponta na direção contrária — mesmo detalhe de listarLeads. */
  const qual = (lead.lead_qualifications as unknown as
    | { region: string | null; price_max_cents: number | null; bedrooms: number | null; urgency: string | null }[]
    | null)?.[0]

  return {
    encontrado: true,
    nome: cadastro?.full_name ?? lead.name,
    telefone: lead.phone,
    estagio: lead.funnel_stage,
    intencao: lead.intent,
    cadastro: lead.registration_status,
    /* CPF mascarado mesmo aqui: quem lê é corretor autenticado, mas o número
       inteiro não tem uso nenhum numa resposta de chat (§6.2). */
    cpf: cadastro?.cpf_last4 ? `***.***.**${cadastro.cpf_last4.slice(0, 1)}-${cadastro.cpf_last4.slice(1)}` : null,
    ultimo_contato: dataHora(lead.last_contact),
    procura: {
      regiao: qual?.region ?? null,
      preco_max: typeof qual?.price_max_cents === 'number' ? brl(qual.price_max_cents) : null,
      dormitorios: qual?.bedrooms ?? null,
      urgencia: qual?.urgency ?? null,
    },
    visitas: (visitas ?? []).map((v) => {
      const p = v.properties as unknown as { reference_code: string; title: string } | null
      return { quando: dataHora(v.scheduled_at), status: v.status, imovel: p?.reference_code ?? null }
    }),
    negocios: (negocios ?? []).map((n) => {
      const p = n.properties as unknown as { reference_code: string } | null
      return {
        tipo: n.deal_type,
        status: n.status,
        imovel: p?.reference_code ?? null,
        valor: brl(n.rent_price_cents ?? n.sale_price_cents),
      }
    }),
    instrucao:
      'Resuma em texto corrido, curto. Comece pelo que muda a próxima ação do corretor: ' +
      'estágio, o que a pessoa procura e o que está pendente.',
  }
}

async function documentosPendentes(escopo: EscopoCopiloto) {
  const supabase = createAdminClient()

  const consulta = supabase
    .from('documents')
    .select(
      `id, type, created_at,
       registrations ( full_name ),
       deals ( id, deal_type, broker_id, properties ( reference_code ) )`
    )
    .eq('status', 'pendente_revisao')
    .order('created_at', { ascending: true })
    .limit(50)

  const { data, error } = await consulta
  if (error) return { erro: error.message }

  let linhas = (data ?? []).map((d) => {
    const cadastro = d.registrations as unknown as { full_name: string } | null
    const negocio = d.deals as unknown as {
      id: string
      deal_type: string
      broker_id: string | null
      properties: { reference_code: string } | null
    } | null
    return {
      documento: ROTULO_DOCUMENTO[d.type] ?? d.type,
      cliente: cadastro?.full_name ?? 'sem nome',
      imovel: negocio?.properties?.reference_code ?? null,
      recebido: dataHora(d.created_at),
      _broker: negocio?.broker_id ?? null,
    }
  })

  /* Filtro em memória: a coluna do corretor está no `deals` relacionado, e o
     PostgREST não filtra por coluna de tabela aninhada num select como este. */
  if (escopo.brokerId) linhas = linhas.filter((l) => l._broker === escopo.brokerId)

  const semInterno = linhas.map(({ _broker, ...resto }) => { void _broker; return resto })

  return {
    total: semInterno.length,
    documentos: semInterno,
    instrucao: semInterno.length
      ? 'Agrupe por cliente. Diga que a conferência é em /admin/documentos.'
      : 'Nada pendente de conferência. Uma frase basta.',
  }
}

async function situacaoNegocio(escopo: EscopoCopiloto, params: { busca: string }) {
  const supabase = createAdminClient()
  const termo = params.busca.trim()

  let consulta = supabase
    .from('deals')
    .select(
      `id, deal_type, status, rent_price_cents, sale_price_cents, documentos_solicitados,
       created_at, broker_id,
       registrations!deals_client_registration_id_fkey ( full_name ),
       properties ( reference_code, title, region )`
    )
    .order('created_at', { ascending: false })
    .limit(20)

  if (escopo.brokerId) consulta = consulta.eq('broker_id', escopo.brokerId)

  const { data, error } = await consulta
  if (error) return { erro: error.message }

  const alvo = termo.toLowerCase()
  const candidatos = (data ?? []).filter((n) => {
    const cliente = (n.registrations as unknown as { full_name: string } | null)?.full_name ?? ''
    const imovel = (n.properties as unknown as { reference_code: string } | null)?.reference_code ?? ''
    return cliente.toLowerCase().includes(alvo) || imovel.toLowerCase().includes(alvo)
  })

  if (!candidatos.length) {
    return {
      encontrado: false,
      instrucao: 'Nenhum negócio bate com essa busca dentro do que ele acompanha. Diga isso.',
    }
  }

  if (candidatos.length > 1) {
    return {
      varios: candidatos.map((n) => ({
        cliente: (n.registrations as unknown as { full_name: string } | null)?.full_name,
        imovel: (n.properties as unknown as { reference_code: string } | null)?.reference_code,
        status: n.status,
      })),
      instrucao: 'Mais de um negócio bate. Liste e pergunte qual.',
    }
  }

  const negocio = candidatos[0]
  const { data: docs } = await supabase
    .from('documents')
    .select('type, status')
    .eq('deal_id', negocio.id)

  const pedidos = (negocio.documentos_solicitados ?? []) as string[]
  const recebidos = new Set((docs ?? []).map((d) => d.type))

  return {
    encontrado: true,
    cliente: (negocio.registrations as unknown as { full_name: string } | null)?.full_name,
    imovel: (negocio.properties as unknown as { reference_code: string; title: string } | null)
      ?.reference_code,
    tipo: negocio.deal_type,
    status: negocio.status,
    valor: brl(negocio.rent_price_cents ?? negocio.sale_price_cents),
    documentos_recebidos: (docs ?? []).map((d) => ({
      documento: ROTULO_DOCUMENTO[d.type] ?? d.type,
      situacao: d.status,
    })),
    documentos_faltando: pedidos
      .filter((p) => !recebidos.has(p))
      .map((p) => ROTULO_DOCUMENTO[p] ?? p),
    instrucao:
      'Diga o status e, principalmente, o que falta para destravar. Não prometa aprovação — ' +
      'quem aprova é humano, e só depois de conferir os documentos.',
  }
}

// ---------------------------------------------------------------------------

/**
 * Monta as tools já amarradas ao escopo da sessão. O escopo entra por closure,
 * nunca pelos argumentos que o modelo produz.
 */
/** Ferramenta e o recurso da §9.2 que a autoriza. */
const DE_CARTEIRA: {
  recurso: string
  tool: Tool
  handler: (escopo: EscopoCopiloto, args: Record<string, unknown>) => Promise<unknown>
}[] = [
  {
    recurso: 'visitas',
    tool: getMyAgendaTool,
    handler: (e, a) => agenda(e, a as { periodo: string }),
  },
  {
    recurso: 'resumos',
    tool: getLeadSummaryTool,
    handler: (e, a) => resumoLead(e, a as { busca: string }),
  },
  { recurso: 'documentos', tool: getPendingDocumentsTool, handler: (e) => documentosPendentes(e) },
  {
    recurso: 'contratos',
    tool: getDealStatusTool,
    handler: (e, a) => situacaoNegocio(e, a as { busca: string }),
  },
]

export function criarToolsCopiloto(escopo: EscopoCopiloto): {
  tools: Tool[]
  handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>
} {
  const tools: Tool[] = []
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {}

  for (const f of [...DE_CARTEIRA, ...FERRAMENTAS_NEGOCIAIS]) {
    if (!escopo.recursos.includes(f.recurso)) continue
    tools.push(f.tool)
    /* O tipo da SDK cobre também tool "custom", que não tem `.function`. Aqui
       só existem tools de função — todas declaradas neste arquivo. */
    if (f.tool.type !== 'function') continue
    handlers[f.tool.function.name] = (args) => f.handler(escopo, args)
  }

  return { tools, handlers }
}
