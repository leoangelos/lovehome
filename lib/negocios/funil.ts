// ==========================================
// Funil e papéis quando o negócio muda de fase — o que o Kanban mostra.
//
// O contato subia até 'em_negociacao' (create_deal) e parava lá para sempre:
// a ativação do contrato atualizava negócio e imóvel e esquecia o funil — o
// cliente que já tinha COMPRADO continuava "Em negociação" no painel. E a
// locação ativada não gravava o papel 'inquilino_ativo', então a regra do
// Orquestrador que manda inquilino falando de boleto para o Suporte nunca
// casava com um inquilino de verdade.
//
// Best-effort consciente: falha aqui é logada e não derruba a ativação — o
// contrato assinado vale mais que a coluna do Kanban.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'

/** Contrato ativado/concluído: o cliente virou 'convertido' no funil. */
export async function marcarConvertido(registrationId: string, dealType: 'locacao' | 'venda'): Promise<void> {
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('contacts')
    .update({ funnel_stage: 'convertido', updated_at: new Date().toISOString() })
    .eq('registration_id', registrationId)
  if (error) console.error('[funil] não moveu para convertido:', error.message)

  /* Locação ativa: o papel é o que abre o Suporte (boleto, contrato, reajuste)
     no roteamento. UNIQUE(registration_id, role) — duplicado é ignorado. */
  if (dealType === 'locacao') {
    const { error: erroPapel } = await supabase
      .from('contact_roles')
      .upsert(
        { registration_id: registrationId, role: 'inquilino_ativo' },
        { onConflict: 'registration_id,role', ignoreDuplicates: true }
      )
    if (erroPapel) console.error('[funil] não gravou inquilino_ativo:', erroPapel.message)
  }
}

/**
 * Proposta recusada ou negócio desfeito: se a pessoa NÃO tem mais nenhum
 * negócio vivo, 'em_negociacao' volta para 'qualificado'. Só mexe em quem está
 * em 'em_negociacao' — estágio movido à mão pelo corretor não é sobrescrito —
 * e só quando não sobrou negócio nenhum: quem ainda tem outra proposta na fila
 * continua negociando.
 */
export async function recuarFunilSeSemNegocioVivo(registrationId: string): Promise<void> {
  const supabase = createAdminClient()

  const { count, error } = await supabase
    .from('deals')
    .select('id', { count: 'exact', head: true })
    .eq('client_registration_id', registrationId)
    .in('status', ['proposta', 'em_aprovacao', 'aprovado', 'ativo', 'encerramento_solicitado'])
  if (error) {
    console.error('[funil] não consultou negócios vivos:', error.message)
    return
  }
  if ((count ?? 0) > 0) return

  const { error: erroUpdate } = await supabase
    .from('contacts')
    .update({ funnel_stage: 'qualificado', updated_at: new Date().toISOString() })
    .eq('registration_id', registrationId)
    .eq('funnel_stage', 'em_negociacao')
  if (erroUpdate) console.error('[funil] não recuou o funil:', erroUpdate.message)
}
