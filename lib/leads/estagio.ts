// ==========================================
// Movimentação de lead entre estágios do funil.
//
// Fora da rota HTTP para ser testável sem subir sessão.
//
// O estágio é escrito por duas mãos: o agente (`save_qualification` e o
// pipeline) e a pessoa, arrastando o cartão no painel. As duas são legítimas —
// o corretor sabe coisas que a conversa não contém ("liguei e ele desistiu").
// Por isso não há trava de transição: qualquer estágio alcança qualquer outro.
// Inventar um fluxo obrigatório aqui só criaria atrito com a realidade da
// operação, que não é linear.
//
// O que existe é rastro: toda mudança feita por pessoa vai para o log, com
// quem, de onde para onde.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { ESTAGIOS } from '@/lib/queries/painel'
import type { FunnelStage } from '@/lib/types/domain'

export type ResultadoMovimento =
  | { ok: true; de: FunnelStage; para: FunnelStage }
  | { ok: false; erro: string; status: number }

export async function moverEstagio(params: {
  contactId: string
  estagio: string
  email: string
  /** Quando informado, só move se o lead pertencer a este corretor (§9.3). */
  brokerId?: string | null
}): Promise<ResultadoMovimento> {
  if (!ESTAGIOS.includes(params.estagio as FunnelStage)) {
    return { ok: false, erro: 'Estágio inválido.', status: 400 }
  }

  const supabase = createAdminClient()

  const { data: contato } = await supabase
    .from('contacts')
    .select('id, name, funnel_stage, assigned_broker_id')
    .eq('id', params.contactId)
    .maybeSingle()

  if (!contato) return { ok: false, erro: 'Lead não encontrado.', status: 404 }

  /* Recorte por carteira aplicado aqui também, e não só na rota: esta função é
     o ponto por onde a mudança acontece, e é onde a regra tem que valer. */
  if (params.brokerId && contato.assigned_broker_id !== params.brokerId) {
    return { ok: false, erro: 'Este lead não é da sua carteira.', status: 403 }
  }

  const de = contato.funnel_stage as FunnelStage
  const para = params.estagio as FunnelStage

  if (de === para) return { ok: true, de, para }

  const { error } = await supabase
    .from('contacts')
    .update({ funnel_stage: para, updated_at: new Date().toISOString() })
    .eq('id', params.contactId)

  if (error) {
    console.error('[painel] movimento falhou:', error.message)
    return { ok: false, erro: 'Não foi possível mover o lead.', status: 500 }
  }

  /* Rastro no log da aplicação, não em tabela. Não existe histórico de funil no
     schema, e criar um só para isto seria decisão de produto — o que se perde
     hoje é a auditoria de quem moveu, não o estado, que está no contato. */
  console.log(
    `[painel] ${params.email} moveu "${contato.name ?? params.contactId}" de ${de} para ${para}`
  )

  return { ok: true, de, para }
}
