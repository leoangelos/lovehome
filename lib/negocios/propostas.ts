// ==========================================
// Fila de propostas e o ciclo aceite → documentos → (desfazer se preciso).
//
// A regra, fora da rota HTTP, no estilo de lib/agenda/visitas:
//
//   * Proposta NÃO trava o imóvel. Várias pessoas podem propor no mesmo
//     imóvel; a vitrine continua mostrando ele.
//   * ACEITAR uma proposta é o que reserva o imóvel, abre a coleta de
//     documentos (documentos_solicitados — é isso que faz foto virar documento
//     no webhook) e avisa o cliente. Só então o Closer volta a falar de docs.
//   * RECUSAR uma proposta não mexe no imóvel e avisa o cliente.
//   * DESFAZER um negócio aceito (documento reprovado de vez, financiamento
//     negado, desistência) devolve o imóvel à vitrine e avisa o cliente. As
//     propostas que ficaram na fila continuam lá para a equipe avaliar.
//
// Ordem da fila (regra do produto): enquanto NENHUMA proposta do imóvel foi
// avaliada, a de maior valor aparece primeiro; a partir da primeira avaliação,
// vale a ordem de chegada. A ordem é GUIA, não trava — quem decide é a equipe,
// que sabe coisas que o sistema não vê (proponente à vista vs. financiado).
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { avisarCliente, contatoDoCadastro, primeiroNomeDoContato } from '@/lib/notificacoes/cliente'
import { brl } from '@/lib/utils/format'

export type Resultado<T = unknown> =
  | ({ ok: true; aviso: { enviado: boolean; motivo?: string } | null } & T)
  | { ok: false; erro: string; status: number }

/** Recorte do painel: corretor só mexe nos negócios da própria carteira. */
export interface AutorPainel {
  brokerId: string | null
  recorteProprio: boolean
}

/* O que o aceite pede de documento — o mesmo catálogo do request_documents. */
const DOCUMENTOS_POR_TIPO: Record<string, string[]> = {
  locacao: ['rg_cnh', 'comprovante_renda', 'comprovante_residencia'],
  venda: ['rg_cnh', 'comprovante_renda'],
}

const ROTULO_DOCUMENTO: Record<string, string> = {
  rg_cnh: 'RG ou CNH',
  comprovante_renda: 'comprovante de renda',
  comprovante_residencia: 'comprovante de residência',
}

// ==========================================
// Ordenação — pura, para o check rodar sem banco
// ==========================================

export interface PropostaNaFila {
  id: string
  valorCents: number | null
  createdAt: string
}

/**
 * Ordena as propostas pendentes de UM imóvel na ordem em que devem ser
 * avaliadas. `jaAvaliouAlguma` = alguma proposta deste imóvel já foi aceita ou
 * recusada um dia (proposta_avaliada_em preenchido em qualquer linha).
 */
export function ordenarPropostas<T extends PropostaNaFila>(pendentes: T[], jaAvaliouAlguma: boolean): T[] {
  const porChegada = (a: T, b: T) => a.createdAt.localeCompare(b.createdAt)
  if (jaAvaliouAlguma) return [...pendentes].sort(porChegada)
  return [...pendentes].sort((a, b) => (b.valorCents ?? 0) - (a.valorCents ?? 0) || porChegada(a, b))
}

// ==========================================
// Internos
// ==========================================

interface NegocioCarregado {
  id: string
  deal_type: 'locacao' | 'venda'
  status: string
  property_id: string | null
  broker_id: string | null
  client_registration_id: string
  rent_price_cents: number | null
  sale_price_cents: number | null
  properties: { id: string; reference_code: string; title: string; status: string } | null
}

async function carregarNegocio(dealId: string): Promise<NegocioCarregado | null> {
  const { data } = await createAdminClient()
    .from('deals')
    .select(
      `id, deal_type, status, property_id, broker_id, client_registration_id,
       rent_price_cents, sale_price_cents,
       properties ( id, reference_code, title, status )`
    )
    .eq('id', dealId)
    .maybeSingle()
  return (data as unknown as NegocioCarregado) ?? null
}

function podeMexer(n: NegocioCarregado, autor: AutorPainel): boolean {
  if (!autor.recorteProprio) return true
  return !!n.broker_id && n.broker_id === autor.brokerId
}

function valorDo(n: NegocioCarregado): number | null {
  return n.deal_type === 'locacao' ? n.rent_price_cents : n.sale_price_cents
}

async function avisar(registrationId: string, montar: (nome: string) => string) {
  const contactId = await contatoDoCadastro(registrationId)
  if (!contactId) return { enviado: false, motivo: 'cadastro sem contato de conversa' }
  const nome = await primeiroNomeDoContato(contactId)
  return avisarCliente(contactId, montar(nome))
}

// ==========================================
// Ações do painel
// ==========================================

/**
 * Aceita a proposta: é AQUI que o imóvel sai da vitrine e a coleta de
 * documentos começa — não no momento da proposta.
 */
export async function aceitarProposta(params: {
  dealId: string
  autor: AutorPainel
  avisarCliente?: boolean
}): Promise<Resultado> {
  const supabase = createAdminClient()
  const n = await carregarNegocio(params.dealId)

  if (!n) return { ok: false, erro: 'Negócio não encontrado.', status: 404 }
  if (!podeMexer(n, params.autor)) return { ok: false, erro: 'Este negócio não é da sua carteira.', status: 403 }
  if (n.status !== 'proposta') {
    return { ok: false, erro: `Só proposta pendente pode ser aceita (esta está "${n.status}").`, status: 409 }
  }
  if (!n.properties) return { ok: false, erro: 'Proposta sem imóvel.', status: 422 }
  if (n.properties.status !== 'disponivel') {
    return {
      ok: false,
      erro: `O imóvel está "${n.properties.status}" — outro negócio já o reservou. Desfaça aquele antes, ou recuse esta proposta.`,
      status: 409,
    }
  }

  const documentos = DOCUMENTOS_POR_TIPO[n.deal_type] ?? []
  const agora = new Date().toISOString()

  const { error } = await supabase
    .from('deals')
    .update({
      status: 'em_aprovacao',
      proposta_avaliada_em: agora,
      documentos_solicitados: documentos,
      documentos_solicitados_em: agora,
      updated_at: agora,
    })
    .eq('id', n.id)
    .eq('status', 'proposta')
  if (error) return { ok: false, erro: 'Não foi possível aceitar.', status: 500 }

  /* Reserva só sai de 'disponivel': se outro aceite correu na frente, nada é
     sobrescrito — e o negócio recém-aceito fica visível como "reservou depois"
     na tela, que é melhor do que dois imóveis reservados em silêncio. */
  await supabase
    .from('properties')
    .update({ status: 'reservado', updated_at: agora })
    .eq('id', n.properties.id)
    .eq('status', 'disponivel')

  const lista = documentos.map((d) => ROTULO_DOCUMENTO[d] ?? d).join(', ')
  const aviso =
    params.avisarCliente === false
      ? null
      : await avisar(
          n.client_registration_id,
          (nome) =>
            `Boa notícia${nome}! Sua proposta pelo ${n.properties!.reference_code} — ${n.properties!.title} foi aceita. ` +
            `Para seguir, preciso de alguns documentos: ${lista}. ` +
            `Pode mandar foto legível ou PDF aqui mesmo, um de cada vez. A equipe confere e te retorno por aqui.`
        )

  return { ok: true, aviso }
}

/** Recusa a proposta. O imóvel não muda — ele nunca foi travado por ela. */
export async function recusarProposta(params: {
  dealId: string
  autor: AutorPainel
  motivo?: string | null
  avisarCliente?: boolean
}): Promise<Resultado> {
  const supabase = createAdminClient()
  const n = await carregarNegocio(params.dealId)

  if (!n) return { ok: false, erro: 'Negócio não encontrado.', status: 404 }
  if (!podeMexer(n, params.autor)) return { ok: false, erro: 'Este negócio não é da sua carteira.', status: 403 }
  if (n.status !== 'proposta') {
    return { ok: false, erro: `Só proposta pendente pode ser recusada (esta está "${n.status}").`, status: 409 }
  }

  const motivo = (params.motivo ?? '').trim().slice(0, 300) || null
  const agora = new Date().toISOString()

  const { error } = await supabase
    .from('deals')
    .update({
      status: 'cancelado',
      proposta_avaliada_em: agora,
      recusa_motivo: motivo,
      updated_at: agora,
    })
    .eq('id', n.id)
    .eq('status', 'proposta')
  if (error) return { ok: false, erro: 'Não foi possível recusar.', status: 500 }

  const valor = valorDo(n)
  const aviso =
    params.avisarCliente === false
      ? null
      : await avisar(
          n.client_registration_id,
          (nome) =>
            `Oi${nome}! Sobre sua proposta${valor ? ` de ${brl(valor)}` : ''} pelo ` +
            `${n.properties?.reference_code ?? 'imóvel'}: infelizmente o valor não foi aceito` +
            (motivo ? ` (${motivo})` : '') +
            `. Se quiser fazer uma nova proposta ou ver opções parecidas, é só me chamar por aqui.`
        )

  return { ok: true, aviso }
}

/**
 * Desfaz um negócio aceito que não vai adiante (documento reprovado de vez,
 * financiamento negado, desistência). O imóvel volta à vitrine; as propostas
 * que continuam na fila são devolvidas para a equipe avaliar na ordem.
 */
export async function desfazerNegocio(params: {
  dealId: string
  autor: AutorPainel
  motivo: string
  avisarCliente?: boolean
}): Promise<Resultado<{ propostasNaFila: number }>> {
  const supabase = createAdminClient()
  const n = await carregarNegocio(params.dealId)

  if (!n) return { ok: false, erro: 'Negócio não encontrado.', status: 404 }
  if (!podeMexer(n, params.autor)) return { ok: false, erro: 'Este negócio não é da sua carteira.', status: 403 }
  /* 'ativo' é contrato assinado e cobrança rodando — desfazer isso é rescisão
     (§14), não um botão. Aqui só o que ainda não virou contrato ativo. */
  if (n.status !== 'em_aprovacao' && n.status !== 'aprovado') {
    return {
      ok: false,
      erro: `Só negócio em aprovação ou aprovado pode ser desfeito (este está "${n.status}").`,
      status: 409,
    }
  }

  const motivo = params.motivo.trim().slice(0, 300)
  if (!motivo) {
    return { ok: false, erro: 'Diga o motivo — é o que o cliente recebe e o que a auditoria lê.', status: 400 }
  }

  const agora = new Date().toISOString()
  const { error } = await supabase
    .from('deals')
    .update({ status: 'cancelado', recusa_motivo: motivo, updated_at: agora })
    .eq('id', n.id)
    .in('status', ['em_aprovacao', 'aprovado'])
  if (error) return { ok: false, erro: 'Não foi possível desfazer.', status: 500 }

  if (n.property_id) {
    await supabase
      .from('properties')
      .update({ status: 'disponivel', updated_at: agora })
      .eq('id', n.property_id)
      .eq('status', 'reservado')
  }

  const { count } = n.property_id
    ? await supabase
        .from('deals')
        .select('id', { count: 'exact', head: true })
        .eq('property_id', n.property_id)
        .eq('status', 'proposta')
    : { count: 0 }

  const aviso =
    params.avisarCliente === false
      ? null
      : await avisar(
          n.client_registration_id,
          (nome) =>
            `Oi${nome}! Infelizmente não foi possível seguir com o negócio do ` +
            `${n.properties?.reference_code ?? 'imóvel'}: ${motivo}. ` +
            `Se eu puder ajudar a encontrar outra opção, é só me chamar por aqui.`
        )

  return { ok: true, aviso, propostasNaFila: count ?? 0 }
}
