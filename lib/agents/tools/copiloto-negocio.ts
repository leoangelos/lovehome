// ==========================================
// Ferramentas de caráter negocial do Copiloto do painel (PRD 12.8).
//
// Complementam as de carteira (`copiloto.ts`) com o que qualquer pessoa do
// painel pergunta: quem está em atraso, quantos imóveis estão disponíveis,
// como está o funil, qual o contato de um cliente, o que a empresa responde
// sobre financiamento.
//
// DUAS REGRAS QUE SUSTENTAM ISTO, e nenhuma delas passa pelo modelo:
//
// 1. QUAIS ferramentas existem é decidido pela matriz da §9.2, no servidor. Um
//    editor não recebe a tool de inadimplência — ela não entra na lista que vai
//    para a OpenAI. Filtrar "no prompt" seria pedir ao modelo que guardasse
//    segredo, e prompt não é ponto de aplicação.
//
// 2. O recorte por carteira é ligado por closure, como em `copiloto.ts`.
//    Nenhum schema aqui tem `broker_id` — se tivesse, bastaria o usuário pedir
//    "os atrasados do Bruno" para o modelo preencher e vazar carteira alheia.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { brl, data as formatarData } from '@/lib/utils/format'
import { buscarNoConhecimento } from '@/lib/rag/retriever'
import { ROTULO_ESTAGIO, ROTULOS_STATUS } from '@/lib/ui/rotulos'
import type { EstagioFunil } from '@/lib/ui/rotulos'
import type { EscopoCopiloto } from '@/lib/agents/tools/copiloto'
import type OpenAI from 'openai'

type Tool = OpenAI.ChatCompletionTool

const HOJE = () => new Date().toISOString().slice(0, 10)

// ==========================================
// Portfólio
// ==========================================

export const portfolioTool: Tool = {
  type: 'function',
  function: {
    name: 'get_portfolio_overview',
    description:
      'Números do acervo de imóveis: quantos disponíveis, reservados, alugados, vendidos e em análise, ' +
      'por operação (locação/venda). Use para "quantos imóveis temos disponíveis", "o que está parado em análise".',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
}

async function portfolio(escopo: EscopoCopiloto) {
  const supabase = createAdminClient()

  let consulta = supabase.from('properties').select('status, operation')
  /* O corretor vê o portfólio inteiro para OFERTAR (é o que a §9.3 permite),
     mas os números de gestão saem da carteira dele — senão "quantos imóveis eu
     tenho" responderia o acervo da imobiliária. */
  if (escopo.brokerId) consulta = consulta.eq('broker_id', escopo.brokerId)

  /* O `error` é CONFERIDO, não descartado: o supabase-js devolve a falha no
     retorno em vez de lançar, e uma coluna inexistente vinha voltando como
     "nenhum imóvel" — o Copiloto respondia com convicção que o acervo estava
     vazio com 20 imóveis disponíveis no banco. */
  const { data, error } = await consulta
  if (error) {
    console.error('[copiloto] portfólio falhou:', error.message)
    return { encontrado: false, instrucao: 'Não consegui consultar o acervo agora. Diga isso — não estime.' }
  }
  if (!data?.length) {
    return { encontrado: false, instrucao: 'Nenhum imóvel no recorte. Diga isso sem estimar.' }
  }

  const porStatus: Record<string, number> = {}
  const porOperacao: Record<string, number> = {}
  for (const p of data) {
    porStatus[p.status] = (porStatus[p.status] ?? 0) + 1
    porOperacao[p.operation] = (porOperacao[p.operation] ?? 0) + 1
  }

  return {
    encontrado: true,
    recorte: escopo.brokerId ? 'apenas a sua carteira' : 'imobiliária inteira',
    total: data.length,
    por_status: Object.entries(porStatus).map(([k, v]) => ({
      status: ROTULOS_STATUS[k] ?? k,
      quantidade: v,
    })),
    por_operacao: Object.entries(porOperacao).map(([k, v]) => ({ operacao: k, quantidade: v })),
  }
}

// ==========================================
// Inadimplência
// ==========================================

export const inadimplenciaTool: Tool = {
  type: 'function',
  function: {
    name: 'get_overdue_payments',
    description:
      'Aluguéis vencidos e não pagos. Use para "quem está em atraso", "quanto temos a receber vencido", ' +
      '"inadimplência do mês".',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
}

async function inadimplencia(escopo: EscopoCopiloto) {
  const supabase = createAdminClient()

  const { data, error: erroParcelas } = await supabase
    .from('lease_payments')
    .select(
      `id, due_date, amount_cents, status,
       deals!inner ( id, broker_id, properties ( reference_code ),
                     registrations!deals_client_registration_id_fkey ( full_name ) )`
    )
    /* "Vencida" é CALCULADO comparando a data com hoje, não lido de `status`:
       a coluna só vira 'atrasado' quando o Asaas manda PAYMENT_OVERDUE, e
       confiar nela esconderia inadimplência até o webhook chegar. */
    .in('status', ['pendente', 'atrasado'])
    .lt('due_date', HOJE())
    .order('due_date', { ascending: true })
    .limit(50)

  if (erroParcelas) {
    console.error('[copiloto] inadimplência falhou:', erroParcelas.message)
    return { encontrado: false, instrucao: 'Não consegui consultar as cobranças agora. Diga isso — não estime.' }
  }

  const linhas = (data ?? []).filter((p) => {
    const negocio = p.deals as unknown as { broker_id: string | null }
    return !escopo.brokerId || negocio?.broker_id === escopo.brokerId
  })

  if (!linhas.length) {
    return { encontrado: false, instrucao: 'Nenhuma parcela vencida em aberto. Diga exatamente isso.' }
  }

  const totalCents = linhas.reduce((t, p) => t + (p.amount_cents ?? 0), 0)

  return {
    encontrado: true,
    quantidade: linhas.length,
    total_em_atraso: brl(totalCents),
    parcelas: linhas.slice(0, 15).map((p) => {
      const negocio = p.deals as unknown as {
        properties: { reference_code: string } | null
        registrations: { full_name: string } | null
      }
      return {
        cliente: negocio?.registrations?.full_name ?? 'sem cadastro',
        imovel: negocio?.properties?.reference_code ?? '—',
        vencimento: formatarData(p.due_date),
        valor: brl(p.amount_cents ?? 0),
        dias_de_atraso: Math.floor(
          (Date.now() - new Date(`${p.due_date}T12:00:00`).getTime()) / 86400_000
        ),
      }
    }),
    instrucao:
      'Cite o total e os casos mais antigos. NÃO prometa negociação, desconto ou prazo — quem decide isso é a equipe.',
  }
}

// ==========================================
// Funil
// ==========================================

export const funilTool: Tool = {
  type: 'function',
  function: {
    name: 'get_funnel_overview',
    description:
      'Quantos leads em cada estágio do funil. Use para "como está o funil", "quantos leads qualificados", ' +
      '"quantos em negociação".',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
}

async function funil(escopo: EscopoCopiloto) {
  const supabase = createAdminClient()

  let consulta = supabase.from('contacts').select('funnel_stage, intent')
  if (escopo.brokerId) consulta = consulta.eq('assigned_broker_id', escopo.brokerId)

  const { data, error } = await consulta
  if (error) {
    console.error('[copiloto] funil falhou:', error.message)
    return { encontrado: false, instrucao: 'Não consegui consultar o funil agora. Diga isso — não estime.' }
  }
  if (!data?.length) return { encontrado: false, instrucao: 'Nenhum lead no recorte.' }

  const porEstagio: Record<string, number> = {}
  for (const c of data) porEstagio[c.funnel_stage] = (porEstagio[c.funnel_stage] ?? 0) + 1

  return {
    encontrado: true,
    recorte: escopo.brokerId ? 'apenas a sua carteira' : 'imobiliária inteira',
    total: data.length,
    por_estagio: Object.entries(porEstagio).map(([k, v]) => ({
      estagio: ROTULO_ESTAGIO[k as EstagioFunil] ?? k,
      quantidade: v,
    })),
  }
}

// ==========================================
// Contato de cliente
// ==========================================

export const contatoTool: Tool = {
  type: 'function',
  function: {
    name: 'find_client_contact',
    description:
      'Acha o telefone e a situação de um cliente pelo nome. Use para "qual o telefone da Maria", ' +
      '"como falo com o João Silva".',
    parameters: {
      type: 'object',
      properties: {
        /* Termo de busca, nunca id: a busca já roda dentro do escopo, e checar
           posse depois de receber um UUID seria mais uma trava para lembrar de
           aplicar. */
        busca: { type: 'string', description: 'Parte do nome do cliente' },
      },
      required: ['busca'],
      additionalProperties: false,
    },
  },
}

async function contato(escopo: EscopoCopiloto, params: { busca: string }) {
  const supabase = createAdminClient()

  let consulta = supabase
    .from('contacts')
    .select(
      'id, name, phone, funnel_stage, registration_status, last_contact, registrations ( full_name, cpf_last4 )'
    )
    .ilike('name', `%${params.busca}%`)
    .limit(10)

  if (escopo.brokerId) consulta = consulta.eq('assigned_broker_id', escopo.brokerId)

  const { data, error } = await consulta
  if (error) {
    console.error('[copiloto] busca de contato falhou:', error.message)
    return { encontrado: false, instrucao: 'Não consegui buscar agora. Diga isso — não invente contato.' }
  }
  if (!data?.length) {
    return {
      encontrado: false,
      instrucao: escopo.brokerId
        ? 'Nenhum contato com esse nome NA SUA CARTEIRA. Pode existir com outro corretor.'
        : 'Nenhum contato com esse nome.',
    }
  }

  return {
    encontrado: true,
    contatos: data.map((c) => {
      const cadastro = c.registrations as unknown as {
        full_name: string
        cpf_last4: string
      } | null
      return {
        nome: cadastro?.full_name ?? c.name ?? 'sem nome',
        telefone: c.phone,
        estagio: ROTULO_ESTAGIO[c.funnel_stage as EstagioFunil] ?? c.funnel_stage,
        cadastro: c.registration_status,
        // CPF sempre mascarado (§6.2) — nem o Copiloto vê o número inteiro.
        cpf: cadastro?.cpf_last4 ? `***.***.**${cadastro.cpf_last4.slice(-2)}` : null,
        ultimo_contato: c.last_contact ? formatarData(c.last_contact.slice(0, 10)) : null,
      }
    }),
  }
}

// ==========================================
// Conhecimento institucional (RAG)
// ==========================================

export const conhecimentoTool: Tool = {
  type: 'function',
  function: {
    name: 'search_knowledge_base',
    description:
      'Consulta os materiais da imobiliária: políticas, financiamento, documentação, glossário. ' +
      'Use para "qual a nossa política de visitas", "como funciona o financiamento", "o que é ITBI".',
    parameters: {
      type: 'object',
      properties: {
        pergunta: { type: 'string', description: 'A pergunta, com as palavras de quem perguntou' },
      },
      required: ['pergunta'],
      additionalProperties: false,
    },
  },
}

async function conhecimento(params: { pergunta: string }) {
  const trechos = await buscarNoConhecimento({ consulta: params.pergunta })

  if (!trechos.length) {
    return {
      encontrado: false,
      instrucao:
        'Nada nos materiais da imobiliária sobre isso. Diga que não há material indexado e ' +
        'NÃO responda de memória: regra, prazo ou percentual inventado vira decisão errada.',
    }
  }

  return {
    encontrado: true,
    trechos: trechos.map((t) => ({ material: t.documento, categoria: t.categoria, texto: t.content })),
    instrucao: 'Responda apenas com o que está nos trechos, citando o material.',
  }
}

// ==========================================
// Contratos
// ==========================================

export const contratosTool: Tool = {
  type: 'function',
  function: {
    name: 'get_contracts_overview',
    description:
      'Situação dos contratos: quantos ativos, aguardando assinatura, aprovados sem contrato gerado. ' +
      'Use para "quantos contratos ativos", "o que está parado esperando assinatura".',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
}

async function contratos(escopo: EscopoCopiloto) {
  const supabase = createAdminClient()

  let consulta = supabase
    .from('deals')
    .select('id, status, deal_type, contract_document_url, signed_document_url, asaas_subscription_id')

  if (escopo.brokerId) consulta = consulta.eq('broker_id', escopo.brokerId)

  const { data, error } = await consulta
  if (error) {
    console.error('[copiloto] contratos falhou:', error.message)
    return { encontrado: false, instrucao: 'Não consegui consultar os negócios agora. Diga isso — não estime.' }
  }
  if (!data?.length) return { encontrado: false, instrucao: 'Nenhum negócio no recorte.' }

  const porStatus: Record<string, number> = {}
  for (const d of data) porStatus[d.status] = (porStatus[d.status] ?? 0) + 1

  const aprovadoSemContrato = data.filter((d) => d.status === 'aprovado' && !d.contract_document_url).length
  const geradoSemAssinatura = data.filter((d) => d.contract_document_url && !d.signed_document_url).length
  /* Ativar não é desfeito quando a criação da cobrança falha — o preço dessa
     decisão é que alguém precisa ver o que ficou para trás. */
  const ativoSemCobranca = data.filter(
    (d) => d.status === 'ativo' && d.deal_type === 'locacao' && !d.asaas_subscription_id
  ).length

  return {
    encontrado: true,
    recorte: escopo.brokerId ? 'apenas a sua carteira' : 'imobiliária inteira',
    total: data.length,
    por_status: Object.entries(porStatus).map(([k, v]) => ({ status: k, quantidade: v })),
    aprovados_sem_contrato_gerado: aprovadoSemContrato,
    gerados_aguardando_assinatura: geradoSemAssinatura,
    locacoes_ativas_sem_cobranca: ativoSemCobranca,
  }
}

// ==========================================
// Montagem, filtrada pela matriz da §9.2
// ==========================================

export interface FerramentaNegocial {
  /** Recurso da §9.2 que autoriza esta ferramenta. */
  recurso: string
  tool: Tool
  handler: (escopo: EscopoCopiloto, args: Record<string, unknown>) => Promise<unknown>
}

export const FERRAMENTAS_NEGOCIAIS: FerramentaNegocial[] = [
  { recurso: 'imoveis', tool: portfolioTool, handler: (e) => portfolio(e) },
  { recurso: 'pagamentos', tool: inadimplenciaTool, handler: (e) => inadimplencia(e) },
  { recurso: 'leads', tool: funilTool, handler: (e) => funil(e) },
  {
    recurso: 'leads',
    tool: contatoTool,
    handler: (e, a) => contato(e, a as { busca: string }),
  },
  { recurso: 'contratos', tool: contratosTool, handler: (e) => contratos(e) },
  {
    /* Material institucional é o que a empresa já publicou internamente; quem
       tem acesso ao acervo tem acesso a ele. */
    recurso: 'materiais',
    tool: conhecimentoTool,
    handler: (_e, a) => conhecimento(a as { pergunta: string }),
  },
]
