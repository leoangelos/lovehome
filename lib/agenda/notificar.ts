// ==========================================
// Aviso ao cliente quando o PAINEL cancela, remarca ou confirma uma visita.
//
// Pelo WhatsApp (ou widget) do próprio contato, no canal em que ele conversa.
// Grava em `messages` como `agent: 'sistema'` — aparece na thread e no
// contexto dos agentes (o Agendamento precisa saber que a visita mudou), sem
// se passar por pessoa nem por IA.
//
// Nunca lança: falhar o aviso não pode desfazer o cancelamento que já foi
// gravado. Devolve o motivo para a tela dizer "cancelado, mas o aviso não
// saiu" em vez de fingir que saiu.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchOutgoing } from '@/lib/channels'
import type { Channel } from '@/lib/channels/types'

export interface ResultadoAviso {
  enviado: boolean
  motivo?: string
}

export async function avisarCliente(contactId: string, texto: string): Promise<ResultadoAviso> {
  try {
    const supabase = createAdminClient()

    const { data: contato } = await supabase
      .from('contacts')
      .select('id, phone, channel_default, blocked')
      .eq('id', contactId)
      .maybeSingle()

    if (!contato) return { enviado: false, motivo: 'contato não encontrado' }
    if (contato.blocked) return { enviado: false, motivo: 'contato bloqueado' }

    const canal = (contato.channel_default ?? 'zapi') as Channel

    let endereco: string | null = contato.phone
    if (canal === 'widget') {
      const { data: sessao } = await supabase
        .from('widget_sessions')
        .select('session_token')
        .eq('contact_id', contactId)
        .order('last_seen_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      endereco = sessao?.session_token ?? null
    }
    if (!endereco) return { enviado: false, motivo: 'contato sem telefone/sessão para receber' }

    /* Grava antes de enviar (mesma lição do pipeline): se o envio falhar, o
       histórico mostra que houve a tentativa. Sem conversa aberta, só envia. */
    const { data: conversa } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', contactId)
      .eq('channel', canal)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (conversa) {
      await supabase.from('messages').insert({
        conversation_id: conversa.id,
        contact_id: contactId,
        role: 'assistant',
        content: texto,
        media_type: 'text',
        channel: canal,
        agent: 'sistema',
      })
      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversa.id)
    }

    await dispatchOutgoing(canal, { contactId, externalId: endereco, text: texto, displayName: null })
    return { enviado: true }
  } catch (e) {
    console.error('[notificar] aviso ao cliente falhou:', (e as Error).message)
    return { enviado: false, motivo: 'falha no envio pelo canal' }
  }
}
