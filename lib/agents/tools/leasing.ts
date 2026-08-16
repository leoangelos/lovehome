// ==========================================
// Tools do Closer — reserva/proposta e coleta de documentos (PRD 12.5).
//
// `deals` cobre venda E locação na mesma tabela: o ciclo aprovação → contrato →
// assinatura é idêntico, só a parte financeira diverge (PRD 10.7).
//
// O papel do Closer termina na coleta. Negociar condições, aprovar e gerar
// contrato é humano — `create_deal` cria o negócio em 'em_aprovacao' e para
// por aí.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { brl } from '@/lib/utils/format'
import type OpenAI from 'openai'

type Tool = OpenAI.ChatCompletionTool

/** Documentos por tipo de negócio (PRD 12.5, passo 3). */
const DOCUMENTOS_POR_TIPO: Record<string, string[]> = {
  locacao: ['rg_cnh', 'comprovante_renda', 'comprovante_residencia'],
  venda: ['rg_cnh', 'comprovante_renda'],
}

const ROTULO_DOCUMENTO: Record<string, string> = {
  rg_cnh: 'RG ou CNH',
  comprovante_renda: 'comprovante de renda',
  comprovante_residencia: 'comprovante de residência',
  escritura_imovel: 'escritura do imóvel',
  outro: 'outro documento',
}

export const createDealTool: Tool = {
  type: 'function',
  function: {
    name: 'create_deal',
    description: `Reserva o imóvel e abre o negócio, depois que a pessoa decidiu qual imóvel quer.
Isso TRAVA o imóvel para outras pessoas, então só chame quando houver decisão clara —
não use para "estou pensando" nem para comparar opções.`,
    parameters: {
      type: 'object',
      properties: {
        property_reference: { type: 'string', description: 'Código do imóvel (ex: LH-1001)' },
        deal_type: {
          type: 'string',
          enum: ['locacao', 'venda'],
          description: 'Se é aluguel (locacao) ou compra (venda)',
        },
        valor_proposto_cents: {
          type: 'number',
          description: 'Valor que a pessoa propõe, em centavos. Omita se aceitou o anunciado.',
        },
        financing_type: {
          type: 'string',
          enum: ['a_vista', 'financiado', 'consorcio'],
          description: 'Só para venda: como pretende pagar',
        },
      },
      required: ['property_reference', 'deal_type'],
    },
  },
}

export const requestDocumentsTool: Tool = {
  type: 'function',
  function: {
    name: 'request_documents',
    description: `Registra quais documentos a pessoa precisa enviar e devolve a lista para você
comunicar. Chame logo depois de create_deal.`,
    parameters: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'Id do negócio devolvido por create_deal' },
        precisa_comprovar_financiamento: {
          type: 'boolean',
          description:
            'Só para venda: true quando NÃO for à vista, para pedir a aprovação do financiamento',
        },
      },
      required: ['deal_id'],
    },
  },
}

export const confirmDocumentReceivedTool: Tool = {
  type: 'function',
  function: {
    name: 'confirm_document_received',
    description: `Registra que um documento chegou. Use quando a pessoa enviar um arquivo na
conversa. NÃO avalie o conteúdo do documento — quem confere é a equipe.`,
    parameters: {
      type: 'object',
      properties: {
        deal_id: { type: 'string' },
        tipo: {
          type: 'string',
          enum: ['rg_cnh', 'comprovante_renda', 'comprovante_residencia', 'escritura_imovel', 'outro'],
        },
        arquivo_url: { type: 'string', description: 'URL do arquivo recebido, quando houver' },
      },
      required: ['deal_id', 'tipo'],
    },
  },
}

interface CreateDealParams {
  property_reference: string
  deal_type: 'locacao' | 'venda'
  valor_proposto_cents?: number
  financing_type?: 'a_vista' | 'financiado' | 'consorcio'
}

export async function handleCreateDeal(contactId: string, params: CreateDealParams) {
  const supabase = createAdminClient()

  const { data: contato } = await supabase
    .from('contacts')
    .select('registration_id, assigned_broker_id')
    .eq('id', contactId)
    .single()

  // O gate já barra sem cadastro completo; isto cobre o vínculo ter sumido
  // entre a autorização e a execução.
  if (!contato?.registration_id) {
    return { criado: false, erro: 'Cadastro do cliente não encontrado.' }
  }

  const { data: imovel } = await supabase
    .from('properties')
    .select('id, reference_code, title, status, price_cents, rent_price_cents, broker_id, owner_registration_id')
    .ilike('reference_code', params.property_reference.trim())
    .maybeSingle()

  if (!imovel) {
    return { criado: false, erro: `Imóvel ${params.property_reference} não encontrado.` }
  }

  /* Negócio já aberto por esta pessoa neste imóvel: devolve o existente em vez
     de criar outro. Sem isso, o modelo repetindo a tool geraria dois negócios
     para a mesma reserva, e a fila de aprovação mostraria o caso duplicado. */
  const { data: existente } = await supabase
    .from('deals')
    .select('id, deal_type, status')
    .eq('client_registration_id', contato.registration_id)
    .eq('property_id', imovel.id)
    .in('status', ['em_aprovacao', 'aprovado', 'ativo'])
    .limit(1)
    .maybeSingle()

  if (existente) {
    return {
      criado: false,
      ja_existe: true,
      deal_id: existente.id,
      status: existente.status,
      instrucao: 'Já existe um negócio aberto para esta pessoa neste imóvel. Siga a partir dele.',
    }
  }

  /* Imóvel precisa estar disponível. Reservar o que já está reservado é
     exatamente a situação que trava duas pessoas no mesmo imóvel. */
  if (imovel.status !== 'disponivel') {
    return {
      criado: false,
      erro: `Este imóvel está "${imovel.status}" e não pode ser reservado agora.`,
      instrucao: 'Avise a pessoa com franqueza e ofereça buscar outra opção parecida.',
    }
  }

  const precoAnunciado =
    params.deal_type === 'locacao' ? imovel.rent_price_cents : imovel.price_cents

  if (!precoAnunciado) {
    return {
      criado: false,
      erro: `Este imóvel não está anunciado para ${params.deal_type === 'locacao' ? 'locação' : 'venda'}.`,
    }
  }

  const valor = params.valor_proposto_cents ?? precoAnunciado

  const { data: negocio, error } = await supabase
    .from('deals')
    .insert({
      deal_type: params.deal_type,
      property_id: imovel.id,
      client_registration_id: contato.registration_id,
      owner_registration_id: imovel.owner_registration_id,
      broker_id: contato.assigned_broker_id ?? imovel.broker_id,
      status: 'em_aprovacao',
      ...(params.deal_type === 'locacao'
        ? { rent_price_cents: valor, notice_period_days: 30 }
        : {
            sale_price_cents: valor,
            financing_type: params.financing_type ?? null,
            itbi_status: 'pendente',
          }),
    })
    .select('id')
    .single()

  if (error) return { criado: false, erro: error.message }

  // Trava o imóvel só depois que o negócio existe: na ordem inversa, uma falha
  // no insert deixaria o imóvel reservado sem nada por trás.
  await supabase
    .from('properties')
    .update({ status: 'reservado', updated_at: new Date().toISOString() })
    .eq('id', imovel.id)

  await supabase
    .from('contacts')
    .update({ funnel_stage: 'em_negociacao', updated_at: new Date().toISOString() })
    .eq('id', contactId)

  return {
    criado: true,
    deal_id: negocio.id,
    imovel: `${imovel.reference_code} — ${imovel.title}`,
    tipo: params.deal_type,
    valor: brl(valor),
    valor_anunciado: brl(precoAnunciado),
    proposta_abaixo_do_anunciado: valor < precoAnunciado,
    instrucao:
      'O imóvel está reservado para esta pessoa. Agora peça os documentos com request_documents. ' +
      'Deixe claro que a equipe analisa e retorna — você não aprova nada.',
  }
}

export async function handleRequestDocuments(params: {
  deal_id: string
  precisa_comprovar_financiamento?: boolean
}) {
  const supabase = createAdminClient()

  const { data: negocio } = await supabase
    .from('deals')
    .select('id, deal_type, status')
    .eq('id', params.deal_id)
    .maybeSingle()

  if (!negocio) return { erro: 'Negócio não encontrado.' }

  const lista = [...(DOCUMENTOS_POR_TIPO[negocio.deal_type] ?? [])]

  /* Venda financiada precisa da aprovação do banco; à vista, não. Pedir
     documento que não se aplica atrasa o negócio à toa. */
  if (negocio.deal_type === 'venda' && params.precisa_comprovar_financiamento) {
    lista.push('outro')
  }

  const { error } = await supabase
    .from('deals')
    .update({
      documentos_solicitados: lista,
      documentos_solicitados_em: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', negocio.id)

  if (error) return { erro: error.message }

  const rotulos = lista.map((d) =>
    d === 'outro' && params.precisa_comprovar_financiamento
      ? 'carta de aprovação do financiamento'
      : ROTULO_DOCUMENTO[d]
  )

  return {
    solicitados: rotulos,
    instrucao:
      'Liste os documentos em frase corrida, não em lista com marcadores. Diga que pode mandar ' +
      'aqui mesmo pelo WhatsApp, uma foto legível de cada. Não prometa prazo exato de análise.',
  }
}

export async function handleConfirmDocumentReceived(
  contactId: string,
  params: { deal_id: string; tipo: string; arquivo_url?: string }
) {
  const supabase = createAdminClient()

  const { data: contato } = await supabase
    .from('contacts')
    .select('registration_id')
    .eq('id', contactId)
    .single()

  if (!contato?.registration_id) return { erro: 'Cadastro não encontrado.' }

  /* O webhook já baixou e guardou o arquivo quando a mensagem chegou, abrindo
     a linha como 'outro' — a URL de mídia do Z-API expira e não dava para
     esperar. Aqui o papel do agente é CLASSIFICAR o que já existe, não criar
     outro registro: duplicar deixaria a fila de conferência com o mesmo
     arquivo duas vezes, uma delas sem tipo. */
  const { data: aguardando } = await supabase
    .from('documents')
    .select('id')
    .eq('registration_id', contato.registration_id)
    .eq('type', 'outro')
    .eq('status', 'pendente_revisao')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (aguardando) {
    const { error } = await supabase
      .from('documents')
      .update({ type: params.tipo, deal_id: params.deal_id })
      .eq('id', aguardando.id)
    if (error) return { erro: error.message }
  } else {
    /* Nenhum arquivo guardado: a pessoa disse que enviou mas nada chegou, ou
       o download falhou. Registra assim mesmo, apontando para a conversa, para
       não perder o rastro de que ela afirma ter mandado. */
    const { error } = await supabase.from('documents').insert({
      registration_id: contato.registration_id,
      deal_id: params.deal_id,
      type: params.tipo,
      storage_path: params.arquivo_url ?? `whatsapp://conversa/${contactId}`,
      status: 'pendente_revisao',
    })
    if (error) return { erro: error.message }
  }

  const { data: negocio } = await supabase
    .from('deals')
    .select('documentos_solicitados')
    .eq('id', params.deal_id)
    .maybeSingle()

  const { data: recebidos } = await supabase
    .from('documents')
    .select('type')
    .eq('deal_id', params.deal_id)

  const pedidos = (negocio?.documentos_solicitados ?? []) as string[]
  const jaVieram = new Set((recebidos ?? []).map((d) => d.type))
  const faltam = pedidos.filter((p) => !jaVieram.has(p)).map((d) => ROTULO_DOCUMENTO[d])

  return {
    registrado: true,
    faltam,
    instrucao: faltam.length
      ? 'Confirme o recebimento em uma frase e diga o que ainda falta. NÃO comente o conteúdo do documento.'
      : 'Todos os documentos chegaram. Diga que a equipe vai analisar e retorna. Não aprove nada.',
  }
}
