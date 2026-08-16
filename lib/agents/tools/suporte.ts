// ==========================================
// Tools do Suporte — contrato, boleto e rescisão (PRD 12.6).
//
// A DECISÃO CENTRAL: confirmar o CPF é MECANISMO, não instrução de prompt.
//
// A §12.6 manda "confirme a identidade (CPF) antes de expor qualquer dado de
// contrato ou pagamento". Deixar isso no texto do prompt repetiria o erro que
// este projeto já cometeu três vezes: o modelo esquece, e aqui o esquecimento
// entrega extrato e boleto de alguém para quem estiver com o celular na mão.
//
// Então `confirmar_titularidade` grava um sinal com validade, e as tools
// financeiras SE RECUSAM a rodar sem ele. O gate de cadastro (§6.3) já garante
// que o contato está vinculado a um cadastro; isto é a segunda tranca, para o
// caso de o aparelho ter trocado de mãos.
//
// A comparação é por `cpf_hash` — o número digitado é transformado e comparado
// ao hash guardado. O CPF do titular nunca é lido, nem para conferir.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { redis } from '@/lib/redis/client'
import { hashCpf } from '@/lib/registrations/cpf'
import { normalizarCpf, cpfValido } from '@/lib/registrations/cpf-formato'
import { brl, data as fmtData } from '@/lib/utils/format'
import type OpenAI from 'openai'

type Tool = OpenAI.ChatCompletionTool

/* 12h: cobre um atendimento inteiro, inclusive retomado no mesmo dia, e não
   vira um passe permanente para um aparelho que trocou de dono. */
const VALIDADE_CONFIRMACAO_S = 12 * 60 * 60
/* Poucas tentativas: CPF é curto e a conversa é o canal errado para força
   bruta, mas não custa nada fechar a porta. */
const MAX_TENTATIVAS = 5

const chaveConfirmado = (contactId: string) => `suporte:confirmado:${contactId}`
const chaveTentativas = (contactId: string) => `suporte:tentativas:${contactId}`

export async function titularConfirmado(contactId: string): Promise<boolean> {
  /* `String(...)`, e não comparação estrita: o Upstash desserializa o valor e
     devolve o número 1 onde gravamos a string '1'. Comparar com `=== '1'`
     retorna false para uma confirmação que existe — e o efeito seria pedir o
     CPF de novo a cada mensagem, o que ninguém tolera. */
  return String(await redis.get(chaveConfirmado(contactId))) === '1'
}

/** Chamada pelo teste e por quem precisar reabrir a exigência. */
export async function limparConfirmacao(contactId: string): Promise<void> {
  await redis.del(chaveConfirmado(contactId))
  await redis.del(chaveTentativas(contactId))
}

const PEDIR_CPF = {
  erro: 'titularidade_nao_confirmada',
  instrucao:
    'Antes de falar de contrato, boleto ou pagamento, peça o CPF do titular e chame ' +
    'confirmar_titularidade. Explique que é para proteger os dados dele. NÃO adiante ' +
    'nenhuma informação de contrato ou cobrança antes disso.',
}

// ---------------------------------------------------------------------------

export const confirmarTitularidadeTool: Tool = {
  type: 'function',
  function: {
    name: 'confirmar_titularidade',
    description: `Confere se o CPF informado é o do titular do contrato. Chame ANTES de qualquer
consulta de contrato, boleto ou pagamento. Peça o CPF explicando que é para proteger os
dados da pessoa.`,
    parameters: {
      type: 'object',
      properties: {
        cpf: { type: 'string', description: 'CPF que a pessoa informou, como ela digitou' },
      },
      required: ['cpf'],
    },
  },
}

export const getPaymentStatementTool: Tool = {
  type: 'function',
  function: {
    name: 'get_payment_statement',
    description: `Extrato de aluguel: parcelas, situação de cada uma e link de segunda via das
que estão em aberto.`,
    parameters: {
      type: 'object',
      properties: {
        meses: { type: 'number', description: 'Quantas parcelas trazer. Padrão 6.' },
      },
      required: [],
    },
  },
}

export const getLeaseStatusTool: Tool = {
  type: 'function',
  function: {
    name: 'get_lease_status',
    description: `Situação do contrato de locação: imóvel, vigência, valor e prazo de aviso
prévio para desocupar.`,
    parameters: { type: 'object', properties: {}, required: [] },
  },
}

export const requestLeaseTerminationTool: Tool = {
  type: 'function',
  function: {
    name: 'request_lease_termination',
    description: `Registra um pedido de rescisão. A data pretendida precisa respeitar o aviso
prévio do contrato — se for antes, a tool devolve a data mínima e NÃO registra.`,
    parameters: {
      type: 'object',
      properties: {
        data_pretendida: {
          type: 'string',
          description: 'Data em que a pessoa quer entregar o imóvel, no formato AAAA-MM-DD',
        },
        motivo: { type: 'string', description: 'O que a pessoa disse, em uma frase' },
      },
      required: ['data_pretendida'],
    },
  },
}

// ---------------------------------------------------------------------------

/** Contrato ativo (ou em encerramento) do contato. */
async function contratoDoContato(contactId: string) {
  const supabase = createAdminClient()

  const { data: contato } = await supabase
    .from('contacts')
    .select('registration_id')
    .eq('id', contactId)
    .maybeSingle()

  if (!contato?.registration_id) return null

  const { data: negocio } = await supabase
    .from('deals')
    .select(
      `id, status, rent_price_cents, start_date, end_date, notice_period_days,
       termination_requested_at, termination_effective_date,
       properties ( reference_code, title, region )`
    )
    .eq('client_registration_id', contato.registration_id)
    .eq('deal_type', 'locacao')
    .in('status', ['ativo', 'encerramento_solicitado'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return negocio
    ? { negocio, registrationId: contato.registration_id as string }
    : { negocio: null, registrationId: contato.registration_id as string }
}

export async function handleConfirmarTitularidade(
  contactId: string,
  params: { cpf: string }
) {
  const supabase = createAdminClient()

  const tentativas = Number((await redis.get(chaveTentativas(contactId))) ?? 0)
  if (tentativas >= MAX_TENTATIVAS) {
    return {
      confirmado: false,
      instrucao:
        'Já houve tentativas demais. NÃO peça o CPF de novo. Diga que por segurança a ' +
        'confirmação precisa ser feita com um corretor e use escalate_to_human.',
    }
  }

  if (!cpfValido(params.cpf)) {
    await redis.set(chaveTentativas(contactId), tentativas + 1, { ex: VALIDADE_CONFIRMACAO_S })
    return {
      confirmado: false,
      instrucao: 'O CPF informado não é válido. Peça para a pessoa conferir e repetir.',
    }
  }

  const { data: contato } = await supabase
    .from('contacts')
    .select('registration_id')
    .eq('id', contactId)
    .maybeSingle()

  if (!contato?.registration_id) {
    return {
      confirmado: false,
      instrucao: 'Este contato não tem cadastro vinculado. Use escalate_to_human.',
    }
  }

  const { data: cadastro } = await supabase
    .from('registrations')
    .select('cpf_hash, full_name')
    .eq('id', contato.registration_id)
    .maybeSingle()

  /* Compara HASH com HASH. O CPF do titular não é descriptografado nem para
     conferir — as duas únicas descriptografias do sistema são contrato e Asaas. */
  const confere = Boolean(cadastro) && hashCpf(normalizarCpf(params.cpf)) === cadastro!.cpf_hash

  if (!confere) {
    await redis.set(chaveTentativas(contactId), tentativas + 1, { ex: VALIDADE_CONFIRMACAO_S })
    console.log(`[suporte] CPF não confere para o contato ${contactId} (tentativa ${tentativas + 1})`)
    return {
      confirmado: false,
      instrucao:
        'O CPF não é o do titular deste contrato. NÃO diga qual é o CPF correto nem dê ' +
        'qualquer pista sobre ele. Peça para conferir; se insistir, use escalate_to_human.',
    }
  }

  await redis.set(chaveConfirmado(contactId), '1', { ex: VALIDADE_CONFIRMACAO_S })
  await redis.del(chaveTentativas(contactId))
  console.log(`[suporte] titularidade confirmada para o contato ${contactId}`)

  const primeiro = cadastro!.full_name?.split(' ')[0] ?? null

  return {
    confirmado: true,
    nome: primeiro,
    instrucao:
      'Confirmado. Agora pode consultar contrato e pagamentos. Cumprimente pelo primeiro ' +
      'nome e siga com o que a pessoa pediu.',
  }
}

export async function handleGetPaymentStatement(contactId: string, params: { meses?: number }) {
  if (!(await titularConfirmado(contactId))) return PEDIR_CPF

  const contrato = await contratoDoContato(contactId)
  if (!contrato?.negocio) {
    return {
      encontrado: false,
      instrucao: 'Não há contrato de locação ativo para esta pessoa. Diga isso e ofereça ajuda.',
    }
  }

  const supabase = createAdminClient()
  const { data: parcelas } = await supabase
    .from('lease_payments')
    .select('reference_month, amount_cents, status, due_date, paid_at, boleto_url')
    .eq('deal_id', contrato.negocio.id)
    .order('due_date', { ascending: false })
    .limit(Math.min(params.meses ?? 6, 24))

  const linhas = (parcelas ?? []).map((p) => ({
    competencia: p.reference_month?.slice(0, 7),
    valor: brl(p.amount_cents),
    situacao: p.status,
    vencimento: fmtData(p.due_date),
    pago_em: p.paid_at ? fmtData(p.paid_at) : null,
    /* Link só do que está em aberto: mandar a segunda via de uma parcela já
       paga confunde e às vezes faz a pessoa pagar de novo. */
    segunda_via: p.status === 'pendente' || p.status === 'atrasado' ? p.boleto_url : null,
  }))

  const emAberto = linhas.filter((l) => l.situacao === 'pendente' || l.situacao === 'atrasado')

  return {
    encontrado: true,
    parcelas: linhas,
    em_aberto: emAberto.length,
    instrucao: emAberto.length
      ? 'Diga o que está em aberto e mande o link da segunda via em frase corrida. NÃO ' +
        'invente valor nem data: use exatamente o que está acima.'
      : 'Está tudo em dia. Diga isso em uma frase e ofereça o extrato se ela quiser conferir.',
  }
}

export async function handleGetLeaseStatus(contactId: string) {
  if (!(await titularConfirmado(contactId))) return PEDIR_CPF

  const contrato = await contratoDoContato(contactId)
  if (!contrato?.negocio) {
    return {
      encontrado: false,
      instrucao: 'Não há contrato de locação ativo para esta pessoa. Diga isso e ofereça ajuda.',
    }
  }

  const n = contrato.negocio
  const imovel = n.properties as unknown as {
    reference_code: string
    title: string
    region: string
  } | null

  return {
    encontrado: true,
    imovel: imovel ? `${imovel.reference_code} — ${imovel.title} (${imovel.region})` : null,
    situacao: n.status,
    aluguel: brl(n.rent_price_cents),
    inicio: n.start_date ? fmtData(n.start_date) : null,
    fim: n.end_date ? fmtData(n.end_date) : null,
    aviso_previo_dias: n.notice_period_days,
    rescisao_pedida_em: n.termination_requested_at ? fmtData(n.termination_requested_at) : null,
    rescisao_efetiva_em: n.termination_effective_date ? fmtData(n.termination_effective_date) : null,
    instrucao:
      'Responda só o que a pessoa perguntou, com os valores acima. Não invente cláusula ' +
      'que não esteja aqui — se ela perguntar algo que não está, diga que confirma com um corretor.',
  }
}

export async function handleRequestLeaseTermination(
  contactId: string,
  params: { data_pretendida: string; motivo?: string }
) {
  if (!(await titularConfirmado(contactId))) return PEDIR_CPF

  const contrato = await contratoDoContato(contactId)
  if (!contrato?.negocio) {
    return {
      registrado: false,
      instrucao: 'Não há contrato ativo para rescindir. Diga isso e ofereça ajuda.',
    }
  }

  const n = contrato.negocio

  if (n.status === 'encerramento_solicitado') {
    return {
      registrado: false,
      ja_solicitado: true,
      data_efetiva: n.termination_effective_date ? fmtData(n.termination_effective_date) : null,
      instrucao: 'Já existe pedido de rescisão registrado. Informe a data e não registre de novo.',
    }
  }

  const pretendida = new Date(`${params.data_pretendida}T12:00:00`)
  if (Number.isNaN(pretendida.getTime())) {
    return { registrado: false, instrucao: 'Data inválida. Peça a data no formato dia/mês/ano.' }
  }

  const dias = n.notice_period_days ?? 30
  const minima = new Date()
  minima.setHours(12, 0, 0, 0)
  minima.setDate(minima.getDate() + dias)

  /* A validação é AQUI, não no prompt. O aviso prévio tem efeito contratual —
     registrar uma data menor criaria expectativa que o contrato não sustenta, e
     desfazer isso depois é conversa difícil. */
  if (pretendida < minima) {
    return {
      registrado: false,
      data_minima: fmtData(minima.toISOString()),
      aviso_previo_dias: dias,
      instrucao:
        `O contrato exige ${dias} dias de aviso prévio, então a data pedida não pode ser ` +
        `registrada. Informe a data mínima possível e pergunte se pode registrar nela. ` +
        `NÃO registre sem a pessoa concordar.`,
    }
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('deals')
    .update({
      status: 'encerramento_solicitado',
      termination_requested_at: new Date().toISOString(),
      termination_effective_date: params.data_pretendida,
      updated_at: new Date().toISOString(),
    })
    .eq('id', n.id)

  if (error) {
    console.error('[suporte] rescisão não registrada:', error.message)
    return { registrado: false, instrucao: 'Não consegui registrar agora. Use escalate_to_human.' }
  }

  console.log(`[suporte] rescisão do contrato ${n.id} pedida para ${params.data_pretendida}`)

  return {
    registrado: true,
    data_efetiva: fmtData(pretendida.toISOString()),
    instrucao:
      'Confirme que o pedido foi registrado com a data, e diga que um corretor entra em ' +
      'contato para combinar a vistoria e a entrega das chaves. NÃO prometa devolução de ' +
      'caução nem valor de multa — isso quem calcula é a equipe.',
  }
}
