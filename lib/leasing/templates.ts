// ==========================================
// Gestão dos templates de contrato (PRD 15.1).
//
// Fora da rota HTTP para ser testável sem sessão.
//
// O que este módulo protege: o corpo do template vira PDF assinado por duas
// pessoas. Um `{{valor_aluguel}}` digitado errado sai como `[valor_aluguel]`
// literal no documento — e ninguém percebe até o cliente perguntar. Por isso
// salvar VALIDA os placeholders contra o catálogo, e placeholder desconhecido
// é recusa, não aviso.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { analisarTemplate, type AnalisePlaceholders } from './placeholders'

export type DealType = 'locacao' | 'venda'

export interface TemplateContrato {
  id: string
  deal_type: DealType
  name: string
  body_template: string
  is_active: boolean
  created_at: string
  /** Diagnóstico calculado na leitura — a tela mostra sem precisar salvar. */
  analise: AnalisePlaceholders
}

export type ResultadoTemplate =
  | { ok: true; id: string }
  | { ok: false; erro: string; status: number; detalhe?: string[] }

/** Abaixo disso não é contrato, é rascunho perdido. */
const MINIMO_CORPO = 200

export async function listarTemplates(): Promise<TemplateContrato[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('contract_templates')
    .select('id, deal_type, name, body_template, is_active, created_at')
    .order('deal_type')
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Falha ao listar templates: ${error.message}`)

  return (data ?? []).map((t) => ({
    ...(t as Omit<TemplateContrato, 'analise'>),
    analise: analisarTemplate(t.body_template, t.deal_type as DealType),
  }))
}

export async function salvarTemplate(params: {
  id?: string
  deal_type: DealType
  name: string
  body_template: string
  is_active?: boolean
  email: string
}): Promise<ResultadoTemplate> {
  const nome = params.name?.trim()
  if (!nome) return { ok: false, erro: 'Dê um nome ao modelo.', status: 400 }

  const corpo = params.body_template?.trim()
  if (!corpo || corpo.length < MINIMO_CORPO) {
    return {
      ok: false,
      erro: `Texto curto demais (${corpo?.length ?? 0} caracteres). Isso não sustentaria um contrato.`,
      status: 400,
    }
  }

  const analise = analisarTemplate(corpo, params.deal_type)

  /* Recusa, não aviso: o placeholder errado vira `[chave]` num documento legal
     entregue ao cliente, e o erro só aparece depois de gerado. */
  if (analise.desconhecidos.length) {
    return {
      ok: false,
      erro: `O sistema não sabe preencher: ${analise.desconhecidos.map((c) => `{{${c}}}`).join(', ')}. Use apenas os campos da lista.`,
      status: 400,
      detalhe: analise.desconhecidos,
    }
  }

  /* Já `foraDeContexto` e `faltando` são AVISO na tela, não recusa aqui: um
     contrato de venda pode legitimamente citar prazo de aviso, e cláusula
     omitida às vezes é escolha do jurídico. Barrar seria substituir o
     julgamento de quem redige por uma regra que não conhece o caso. */

  const supabase = createAdminClient()

  const linha = {
    deal_type: params.deal_type,
    name: nome,
    body_template: corpo,
    is_active: params.is_active ?? true,
  }

  if (params.id) {
    const { error } = await supabase.from('contract_templates').update(linha).eq('id', params.id)
    if (error) {
      console.error('[templates] atualização falhou:', error.message)
      return { ok: false, erro: 'Não foi possível salvar.', status: 500 }
    }
    console.log(`[templates] ${params.email} editou o modelo ${params.id}`)
    return { ok: true, id: params.id }
  }

  const { data, error } = await supabase
    .from('contract_templates')
    .insert(linha)
    .select('id')
    .single()

  if (error || !data) {
    console.error('[templates] criação falhou:', error?.message)
    return { ok: false, erro: 'Não foi possível criar o modelo.', status: 500 }
  }

  console.log(`[templates] ${params.email} criou o modelo "${nome}" (${params.deal_type})`)
  return { ok: true, id: data.id }
}

/**
 * Ativa um modelo e desativa os outros do mesmo tipo.
 *
 * `preencherContrato` busca o template ativo do tipo — dois ativos deixaria a
 * escolha ao acaso da ordenação, e dois contratos gerados no mesmo dia sairiam
 * com textos diferentes.
 */
export async function ativarTemplate(id: string, email: string): Promise<ResultadoTemplate> {
  const supabase = createAdminClient()

  const { data: alvo } = await supabase
    .from('contract_templates')
    .select('id, deal_type, name')
    .eq('id', id)
    .maybeSingle()

  if (!alvo) return { ok: false, erro: 'Modelo não encontrado.', status: 404 }

  await supabase
    .from('contract_templates')
    .update({ is_active: false })
    .eq('deal_type', alvo.deal_type)

  const { error } = await supabase
    .from('contract_templates')
    .update({ is_active: true })
    .eq('id', id)

  if (error) return { ok: false, erro: 'Não foi possível ativar.', status: 500 }

  console.log(`[templates] ${email} ativou "${alvo.name}" para ${alvo.deal_type}`)
  return { ok: true, id }
}

/**
 * Apaga um modelo. Recusa o último ativo do tipo: sem template não há como
 * gerar contrato, e a falha só apareceria no momento em que alguém precisasse.
 */
export async function removerTemplate(id: string, email: string): Promise<ResultadoTemplate> {
  const supabase = createAdminClient()

  const { data: alvo } = await supabase
    .from('contract_templates')
    .select('id, deal_type, is_active, name')
    .eq('id', id)
    .maybeSingle()

  if (!alvo) return { ok: false, erro: 'Modelo não encontrado.', status: 404 }

  const { count } = await supabase
    .from('contract_templates')
    .select('id', { count: 'exact', head: true })
    .eq('deal_type', alvo.deal_type)

  if ((count ?? 0) <= 1) {
    return {
      ok: false,
      erro: `Este é o único modelo de ${alvo.deal_type === 'locacao' ? 'locação' : 'venda'}. Sem ele não seria possível gerar contrato.`,
      status: 409,
    }
  }

  const { error } = await supabase.from('contract_templates').delete().eq('id', id)
  if (error) return { ok: false, erro: 'Não foi possível remover.', status: 500 }

  /* Se o removido era o ativo, promove outro: deixar o tipo sem ativo quebraria
     a geração de contrato de um jeito que só aparece na hora do uso. */
  if (alvo.is_active) {
    const { data: sobrou } = await supabase
      .from('contract_templates')
      .select('id')
      .eq('deal_type', alvo.deal_type)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (sobrou) await ativarTemplate(sobrou.id, email)
  }

  console.log(`[templates] ${email} removeu "${alvo.name}"`)
  return { ok: true, id }
}
