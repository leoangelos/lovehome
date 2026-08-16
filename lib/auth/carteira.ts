// ==========================================
// Recorte por carteira nas rotas com id (§9.3).
//
// `autorizarApi('contratos', 'editar')` responde "este PAPEL pode editar
// contratos" — não "este corretor pode editar ESTE contrato". A segunda
// pergunta ficava sem resposta em seis rotas: um corretor com o UUID de um
// negócio, documento ou imóvel de outra carteira aprovava, gerava contrato e
// baixava RG de cliente alheio. UUID v4 não se adivinha, mas a regra do
// projeto é que a rota é a trava, não a obscuridade do id.
//
// Ponto único, para a checagem não depender de cada rota lembrar. Admin e
// viewer passam direto (`escopoProprio` é falso); corretor precisa que o
// recurso aponte para o `broker_id` da sessão.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { escopoProprio } from '@/lib/auth/permissions'
import type { SessaoPainel } from '@/lib/auth/session'

export type Recorte = { ok: true } | { ok: false; erro: string; status: number }

const FORA: Recorte = { ok: false, erro: 'Este item não é da sua carteira.', status: 403 }
const INEXISTENTE: Recorte = { ok: false, erro: 'Não encontrado.', status: 404 }

/** Negócio pertence ao corretor da sessão? */
export async function negocioDaCarteira(dealId: string, sessao: SessaoPainel): Promise<Recorte> {
  if (!escopoProprio(sessao.role)) return { ok: true }

  const { data } = await createAdminClient()
    .from('deals')
    .select('broker_id')
    .eq('id', dealId)
    .maybeSingle()

  if (!data) return INEXISTENTE
  /* Negócio sem corretor não é de ninguém — e portanto não é deste corretor.
     Cair no "ok" aqui deixaria a carteira órfã aberta a todos. */
  if (!data.broker_id || data.broker_id !== sessao.brokerId) return FORA
  return { ok: true }
}

/** Documento pertence a um negócio do corretor da sessão? */
export async function documentoDaCarteira(documentId: string, sessao: SessaoPainel): Promise<Recorte> {
  if (!escopoProprio(sessao.role)) return { ok: true }

  const { data } = await createAdminClient()
    .from('documents')
    .select('deal_id, deals ( broker_id )')
    .eq('id', documentId)
    .maybeSingle()

  if (!data) return INEXISTENTE
  const negocio = data.deals as unknown as { broker_id: string | null } | null
  if (!negocio?.broker_id || negocio.broker_id !== sessao.brokerId) return FORA
  return { ok: true }
}

/** Imóvel pertence ao corretor da sessão? */
export async function imovelDaCarteira(propertyId: string, sessao: SessaoPainel): Promise<Recorte> {
  if (!escopoProprio(sessao.role)) return { ok: true }

  const { data } = await createAdminClient()
    .from('properties')
    .select('broker_id')
    .eq('id', propertyId)
    .maybeSingle()

  if (!data) return INEXISTENTE
  if (!data.broker_id || data.broker_id !== sessao.brokerId) return FORA
  return { ok: true }
}
