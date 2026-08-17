// ==========================================
// Contexto da conversa inteira — o que TODO agente enxerga, independente de
// quem atendeu antes.
//
// A memória por agente (agent_histories) continua sendo o histórico de
// trabalho de cada agente. O que este módulo resolve é a troca de agente: o
// SDR apresentava o imóvel, a pessoa perguntava "que dia posso visitar?", o
// roteador mandava para o Agendamento — e o Agendamento, com histórico próprio
// vazio, perguntava "qual imóvel?". A memória existia, mas numa gaveta que o
// segundo agente nunca abria.
//
// A fonte é a tabela `messages`: já é a conversa em ordem cronológica com tudo
// — cliente, cada agente, corretor humano, follow-up. Entra no prompt como
// BLOCO DE TEXTO, não como mensagens de chat. Mensagem de outro agente como
// `assistant` faria o modelo assumir a autoria e o estilo dela; como
// transcrição rotulada, ele lê como registro do que a equipe já disse.
//
// Duas informações derivadas saem daqui porque a base-agent precisa delas e o
// dado já está em mãos:
//   * urlsEnviadas — o filtro de link inventado só aceita URL de fonte
//     confiável. Link que a equipe JÁ mandou nesta conversa não é invenção;
//     sem isso, o Agendamento repetir o link do imóvel que o SDR enviou seria
//     apagado da resposta.
//   * cadastroJaEnviado — a rede de segurança do link de cadastro checava só o
//     histórico do agente atual, então na troca de agente mandava o link de
//     novo.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { FUSO_BRASIL } from '@/lib/agenda/fuso'

export interface ContextoConversa {
  /** Conversa em que a mensagem atual chegou — vai para llm_usage, para o painel de uso ligar a chamada ao trace. */
  conversationId: string | null
  /** Bloco pronto para colar no prompt. Vazio quando não há conversa anterior. */
  bloco: string
  /** URLs que a equipe (agentes ou humano) já enviou nesta conversa. */
  urlsEnviadas: string[]
  /** Algum atendente já mandou o link de cadastro nesta conversa. */
  cadastroJaEnviado: boolean
  /** Quantas mensagens entraram no bloco. */
  total: number
}

export interface LinhaConversa {
  role: 'user' | 'assistant' | 'system'
  content: string
  agent: string | null
  created_at: string
}

/* 30 mensagens × 800 caracteres é o teto: ~6 mil tokens no pior caso, e na
   prática bem menos — mensagem de WhatsApp é curta. Acima disso o custo por
   turno começa a pesar mais do que o contexto ajuda. */
const LIMITE_MENSAGENS = 30
const LIMITE_CARACTERES = 800

/* Margem para as linhas do turno atual, que são descartadas do bloco. */
const MARGEM_TURNO_ATUAL = 10

const PADRAO_URL = /https?:\/\/[^\s<>"'`)\]]+/g

export const CONTEXTO_VAZIO: ContextoConversa = {
  conversationId: null,
  bloco: '',
  urlsEnviadas: [],
  cadastroJaEnviado: false,
  total: 0,
}

/**
 * Lê a conversa do CONTATO (não só desta conversation) e monta o contexto.
 *
 * Por contato porque é o escopo de tudo que já é memória aqui: agent_histories,
 * active_agent e o resumo para o corretor são por contato. Quem começou no
 * widget e seguiu no WhatsApp continua sendo a mesma pessoa com o mesmo fio.
 *
 * `mensagemAtual` é o texto que o agente vai responder agora. As linhas do
 * turno atual já estão gravadas em `messages` quando o pipeline roda, e
 * ficariam duplicadas (uma vez no bloco, outra como turno do usuário).
 */
export async function carregarContextoConversa(
  contactId: string,
  mensagemAtual: string,
  conversationId: string | null = null
): Promise<ContextoConversa> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('messages')
    .select('role, content, agent, created_at')
    .eq('contact_id', contactId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(LIMITE_MENSAGENS + MARGEM_TURNO_ATUAL)

  /* Sem contexto o agente responde como antes — pior do que com, mas
     infinitamente melhor do que não responder. */
  if (error) {
    console.error('[contexto-conversa] falha ao ler messages:', error.message)
    return { ...CONTEXTO_VAZIO, conversationId }
  }

  const linhas = ((data ?? []) as LinhaConversa[]).reverse()
  return { ...montarContextoConversa(linhas, mensagemAtual), conversationId }
}

/**
 * Parte pura: recebe as linhas em ordem cronológica e devolve o bloco.
 * Separada da leitura do banco para o check rodar sem Supabase.
 */
export function montarContextoConversa(
  linhas: LinhaConversa[],
  mensagemAtual: string
): ContextoConversa {
  const anteriores = removerTurnoAtual(linhas, mensagemAtual).slice(-LIMITE_MENSAGENS)
  if (anteriores.length === 0) return CONTEXTO_VAZIO

  const urls = new Set<string>()
  let cadastroJaEnviado = false

  const transcricao = anteriores.map((m) => {
    if (m.role === 'assistant') {
      for (const url of m.content.match(PADRAO_URL) ?? []) urls.add(url.replace(/[.,;:!?]+$/, ''))
      if (m.content.includes('/cadastro/')) cadastroJaEnviado = true
    }
    return `[${quando(m.created_at)}] ${rotulo(m)}: ${resumir(m.content)}`
  })

  const bloco = `

HISTÓRICO COMPLETO DESTA CONVERSA (ordem cronológica, todos os atendentes):
A pessoa já falou com a equipe da LoveHome antes desta mensagem — às vezes com outro
agente. Isto é o registro do que já foi dito, seu e dos outros. Use para não perguntar o
que já foi respondido e não perder o fio: imóvel já apresentado, horário já discutido,
dado já informado. Você não precisa repetir o que já foi enviado. Você pode reenviar um
link que aparece abaixo se fizer sentido — ele já foi enviado pela equipe.

${transcricao.join('\n')}`

  return {
    conversationId: null,
    bloco,
    urlsEnviadas: [...urls],
    cadastroJaEnviado,
    total: anteriores.length,
  }
}

// ==========================================
// Internos
// ==========================================

/**
 * O turno atual: as últimas mensagens de `user`, ainda sem resposta, cujo texto
 * está contido na mensagem que o agente vai responder. A checagem de conteúdo
 * (e não "todas as últimas de user") importa quando um turno anterior falhou
 * sem resposta do bot — essa mensagem antiga NÃO está em `mensagemAtual` e
 * precisa continuar no bloco, ou some da memória de todo mundo.
 */
function removerTurnoAtual(linhas: LinhaConversa[], mensagemAtual: string): LinhaConversa[] {
  const resultado = [...linhas]
  while (resultado.length > 0) {
    const ultima = resultado[resultado.length - 1]
    if (ultima.role !== 'user') break
    if (!mensagemAtual.includes(ultima.content.trim())) break
    resultado.pop()
  }
  return resultado
}

function rotulo(m: LinhaConversa): string {
  if (m.role === 'user') return 'Cliente'
  switch (m.agent) {
    case 'humano':
      return 'Corretor da LoveHome (humano)'
    case 'followup':
      return 'LoveHome (follow-up automático)'
    case 'despedida':
    case 'escalonamento':
    case null:
    case undefined:
      return 'LoveHome'
    default:
      return `LoveHome (agente ${m.agent})`
  }
}

function resumir(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim()
  return limpo.length > LIMITE_CARACTERES ? `${limpo.slice(0, LIMITE_CARACTERES)}…` : limpo
}

const FORMATO_DATA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO_BRASIL,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** '2026-08-17T16:20:00Z' → '17/08 13:20' (horário de São Paulo). */
function quando(iso: string): string {
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return '?'
  // Intl devolve "17/08, 13:20" — a vírgula é ruído.
  return FORMATO_DATA.format(dt).replace(',', '')
}
