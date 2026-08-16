import { createAdminClient } from '@/lib/supabase/admin'
import { listarLeads, type LeadLinha } from './admin'
import type { FunnelStage } from '@/lib/types/domain'

/* Kanban do funil (PRD 17.1).
 *
 * A alternativa era um kanban de CONVERSAS por status (ativa / humano /
 * escalada). Isso ficaria redundante: `/admin/conversas` já lista, filtra por
 * "esperando resposta" e faz o takeover. Repetir aquilo seria duas telas para o
 * mesmo trabalho.
 *
 * O que falta na operação é a visão de FUNIL — onde cada lead está e o que
 * precisa acontecer para ele andar. É o que a §17.2 chama de "CRM leve".
 */

export { ESTAGIOS, ROTULO_ESTAGIO } from '@/lib/ui/rotulos'
import { ESTAGIOS, ROTULO_ESTAGIO } from '@/lib/ui/rotulos'

export interface CartaoFunil extends LeadLinha {
  conversa_id: string | null
  esperando_resposta: boolean
}

export interface ColunaFunil {
  estagio: FunnelStage
  rotulo: string
  cartoes: CartaoFunil[]
}

export async function montarFunil(brokerId?: string | null): Promise<ColunaFunil[]> {
  const leads = await listarLeads(brokerId)
  const supabase = createAdminClient()

  const porContato = new Map<string, { id: string; esperando: boolean }>()

  if (leads.length) {
    const ids = leads.map((l) => l.id)

    const { data: conversas } = await supabase
      .from('conversations')
      .select('id, contact_id, human_takeover')
      .in('contact_id', ids)
      .order('last_message_at', { ascending: false })

    /* Uma conversa por contato — a mais recente. Contato com várias é o caso de
       quem escreveu por canais diferentes. */
    for (const c of conversas ?? []) {
      if (!porContato.has(c.contact_id)) {
        porContato.set(c.contact_id, { id: c.id, esperando: false })
      }
    }

    const idsConversa = [...porContato.values()].map((c) => c.id)
    if (idsConversa.length) {
      const { data: mensagens } = await supabase
        .from('messages')
        .select('conversation_id, role, created_at')
        .in('conversation_id', idsConversa)
        .order('created_at', { ascending: false })
        .limit(800)

      const vistas = new Set<string>()
      for (const m of mensagens ?? []) {
        if (vistas.has(m.conversation_id)) continue
        vistas.add(m.conversation_id)
        for (const entrada of porContato.values()) {
          /* Última palavra do cliente = alguém precisa agir. É o sinal que faz
             o cartão pedir atenção no meio de uma coluna cheia. */
          if (entrada.id === m.conversation_id) entrada.esperando = m.role === 'user'
        }
      }
    }
  }

  const cartoes: CartaoFunil[] = leads.map((l) => {
    const conversa = porContato.get(l.id)
    return {
      ...l,
      conversa_id: conversa?.id ?? null,
      esperando_resposta: conversa?.esperando ?? false,
    }
  })

  return ESTAGIOS.map((estagio) => ({
    estagio,
    rotulo: ROTULO_ESTAGIO[estagio],
    cartoes: cartoes.filter((c) => c.funnel_stage === estagio),
  }))
}
