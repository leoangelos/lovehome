import { createAdminClient } from '@/lib/supabase/admin'
import { dataIsoLocal, inicioDoDiaLocal } from '@/lib/agenda/fuso'
import { ROTULO_OPERACAO, type OperacaoLLM } from '@/lib/observabilidade/uso'

/* Leituras do painel de uso e custo.
 *
 * Todo custo aqui é ESTIMADO: sai da tabela de preços em
 * lib/observabilidade/uso.ts, que é uma cópia manual do preço da OpenAI e vai
 * ficar desatualizada. Serve para acompanhar tendência e achar o que gasta
 * demais — não para conciliar fatura. A tela diz isso.
 */

export interface ResumoPeriodo {
  requisicoes: number
  tokens: number
  custoUsd: number
  falhas: number
}

export interface LinhaAgrupada {
  chave: string
  rotulo: string
  requisicoes: number
  tokens: number
  custoUsd: number
}

export interface DiaUso {
  dia: string
  requisicoes: number
  tokens: number
  custoUsd: number
}

export interface DetalheRequisicao {
  resumo?: string
  entradas?: { rotulo: string; valor: string }[]
  tools?: { nome: string; ms?: number }[]
}

export interface RequisicaoLinha {
  id: string
  ocorrido_em: string
  operacao: string
  modelo: string
  /* Entrada e saída separadas: saída custa ~4x mais, e o total sozinho não
     explica por que uma resposta longa custou mais que uma busca grande. */
  tokens_entrada: number
  tokens_saida: number
  tokens_total: number
  custo_usd: number
  duracao_ms: number | null
  agente: string | null
  canal: string | null
  conversation_id: string | null
  sucesso: boolean
  erro: string | null
  detalhe: DetalheRequisicao | null
}

export interface PainelUso {
  hoje: ResumoPeriodo
  seteDias: ResumoPeriodo
  trintaDias: ResumoPeriodo
  porDia: DiaUso[]
  porOperacao: LinhaAgrupada[]
  porModelo: LinhaAgrupada[]
  recentes: RequisicaoLinha[]
  /** true quando não há nenhuma linha — a tela explica em vez de mostrar zeros. */
  vazio: boolean
}

interface LinhaCrua {
  ocorrido_em: string
  operacao: string
  modelo: string
  tokens_total: number
  custo_usd: number | string
  sucesso: boolean
}

/* Dia de São Paulo. Em UTC, "hoje" começava às 21h de ontem no Brasil e a
   série diária agrupava pelo dia errado. */
function inicioDoDia(diasAtras = 0): Date {
  return inicioDoDiaLocal(-diasAtras)
}

function somar(linhas: LinhaCrua[]): ResumoPeriodo {
  return {
    requisicoes: linhas.length,
    tokens: linhas.reduce((s, l) => s + (l.tokens_total ?? 0), 0),
    custoUsd: linhas.reduce((s, l) => s + Number(l.custo_usd ?? 0), 0),
    falhas: linhas.filter((l) => !l.sucesso).length,
  }
}

function agrupar(linhas: LinhaCrua[], campo: 'operacao' | 'modelo'): LinhaAgrupada[] {
  const mapa = new Map<string, LinhaAgrupada>()

  for (const l of linhas) {
    const chave = l[campo]
    const atual = mapa.get(chave) ?? {
      chave,
      rotulo: campo === 'operacao' ? (ROTULO_OPERACAO[chave as OperacaoLLM] ?? chave) : chave,
      requisicoes: 0,
      tokens: 0,
      custoUsd: 0,
    }
    atual.requisicoes++
    atual.tokens += l.tokens_total ?? 0
    atual.custoUsd += Number(l.custo_usd ?? 0)
    mapa.set(chave, atual)
  }

  /* Ordenado por CUSTO, não por número de requisições: o que interessa a quem
     abre esta tela é o que está consumindo dinheiro, e mil embeddings custam
     menos que dez respostas de agente. */
  return [...mapa.values()].sort((a, b) => b.custoUsd - a.custoUsd)
}

export async function montarPainelUso(): Promise<PainelUso> {
  const supabase = createAdminClient()
  const desde = inicioDoDia(29).toISOString()

  /* Agregação em memória sobre 30 dias. Enquanto o volume couber em uma
     consulta, é mais simples e mais fácil de conferir do que uma view; quando
     não couber, o caminho é uma materialized view por dia — não paginar isto. */
  const { data, error } = await supabase
    .from('llm_usage')
    .select('ocorrido_em, operacao, modelo, tokens_total, custo_usd, sucesso')
    .gte('ocorrido_em', desde)
    .order('ocorrido_em', { ascending: false })
    .limit(20000)

  if (error) throw new Error(`Falha ao ler o uso: ${error.message}`)

  const linhas = (data ?? []) as LinhaCrua[]

  const limiteHoje = inicioDoDia().getTime()
  const limiteSete = inicioDoDia(6).getTime()

  const deHoje = linhas.filter((l) => new Date(l.ocorrido_em).getTime() >= limiteHoje)
  const deSete = linhas.filter((l) => new Date(l.ocorrido_em).getTime() >= limiteSete)

  // ---- Série diária, com os dias sem uso preenchidos ----
  const porDiaMapa = new Map<string, DiaUso>()
  for (let i = 29; i >= 0; i--) {
    const chave = dataIsoLocal(inicioDoDia(i))
    porDiaMapa.set(chave, { dia: chave, requisicoes: 0, tokens: 0, custoUsd: 0 })
  }
  for (const l of linhas) {
    const chave = dataIsoLocal(new Date(l.ocorrido_em))
    const dia = porDiaMapa.get(chave)
    if (!dia) continue
    dia.requisicoes++
    dia.tokens += l.tokens_total ?? 0
    dia.custoUsd += Number(l.custo_usd ?? 0)
  }

  const { data: recentes } = await supabase
    .from('llm_usage')
    .select(
      'id, ocorrido_em, operacao, modelo, tokens_entrada, tokens_saida, tokens_total, custo_usd, duracao_ms, agente, canal, conversation_id, sucesso, erro, detalhe'
    )
    .order('ocorrido_em', { ascending: false })
    .limit(60)

  return {
    hoje: somar(deHoje),
    seteDias: somar(deSete),
    trintaDias: somar(linhas),
    porDia: [...porDiaMapa.values()],
    porOperacao: agrupar(linhas, 'operacao'),
    porModelo: agrupar(linhas, 'modelo'),
    recentes: (recentes ?? []) as RequisicaoLinha[],
    vazio: linhas.length === 0,
  }
}
