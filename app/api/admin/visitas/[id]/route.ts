import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { escopoProprio } from '@/lib/auth/permissions'
import { interpretarDataHora } from '@/lib/agenda/fuso'
import { cancelarVisita, mudarStatusVisita, reagendarVisita, type Autor } from '@/lib/agenda/visitas'
import { avisarCliente, primeiroNomeDoContato } from '@/lib/notificacoes/cliente'

/* Ações do painel sobre uma visita: confirmar, cancelar, reagendar, marcar
 * realizada ou não compareceu. A regra mora em lib/agenda/visitas — a mesma
 * que o agente usa pelo WhatsApp — e o recorte por carteira é do `autor`:
 * corretor só alcança visitas com o próprio broker_id.
 *
 * `avisar_cliente` manda a mensagem pelo canal do contato. É opcional porque
 * às vezes quem cancela já falou com a pessoa por telefone. */

export const dynamic = 'force-dynamic'

interface Corpo {
  acao: 'confirmar' | 'cancelar' | 'reagendar' | 'realizada' | 'no_show'
  motivo?: string
  scheduled_at?: string
  avisar_cliente?: boolean
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('visitas', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params
  const { sessao } = auth
  const autor: Autor = { tipo: 'painel', brokerId: sessao.brokerId, recorteProprio: escopoProprio(sessao.role) }

  let corpo: Corpo
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const avisar = corpo.avisar_cliente !== false
  let aviso: { enviado: boolean; motivo?: string } | null = null

  if (corpo.acao === 'cancelar') {
    const r = await cancelarVisita({ visitaId: id, autor, motivo: corpo.motivo ?? null })
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
    if (avisar) {
      const nome = await primeiroNomeDoContato(r.contactId)
      const motivo = (corpo.motivo ?? '').trim()
      aviso = await avisarCliente(
        r.contactId,
        `Oi${nome}! Precisamos cancelar a sua visita ao ${r.visita.imovel ?? 'imóvel'} marcada para ${r.visita.descricao}.` +
          (motivo ? ` Motivo: ${motivo}.` : '') +
          ` Se quiser marcar outro horário, é só me responder por aqui.`
      )
    }
    return NextResponse.json({ ok: true, aviso })
  }

  if (corpo.acao === 'reagendar') {
    const novo = interpretarDataHora(corpo.scheduled_at ?? '')
    if (!novo) return NextResponse.json({ erro: 'Informe o novo horário.' }, { status: 400 })

    const r = await reagendarVisita({ visitaId: id, novoQuando: novo, autor })
    if (!r.ok) {
      return NextResponse.json({ erro: r.erro, horarios_livres: r.horarios_livres ?? [] }, { status: r.status })
    }
    if (avisar) {
      const nome = await primeiroNomeDoContato(r.contactId)
      const contato = r.corretor.telefone ? ` (${r.corretor.telefone})` : ''
      aviso = await avisarCliente(
        r.contactId,
        `Oi${nome}! Sua visita ao ${r.visita.imovel ?? 'imóvel'} foi remarcada: de ${r.anterior.descricao} para ${r.visita.descricao}.` +
          ` Quem vai te receber é ${r.corretor.nome}${contato}.` +
          (r.trocouCorretor ? ' (Mudou o corretor.)' : '') +
          ` Qualquer coisa, me avise por aqui.`
      )
    }
    return NextResponse.json({ ok: true, aviso, corretor: r.corretor, trocou_corretor: r.trocouCorretor })
  }

  if (corpo.acao === 'confirmar' || corpo.acao === 'realizada' || corpo.acao === 'no_show') {
    const status = corpo.acao === 'confirmar' ? 'confirmada' : corpo.acao
    const r = await mudarStatusVisita({ visitaId: id, status, autor })
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
    if (avisar && status === 'confirmada') {
      const nome = await primeiroNomeDoContato(r.contactId)
      const c = r.visita.corretor
      aviso = await avisarCliente(
        r.contactId,
        `Oi${nome}! Confirmando sua visita ao ${r.visita.imovel ?? 'imóvel'} ${r.visita.descricao}` +
          (c ? ` com ${c.nome}${c.telefone ? ` (${c.telefone})` : ''}` : '') +
          `. Até lá!`
      )
    }
    return NextResponse.json({ ok: true, aviso })
  }

  return NextResponse.json({ erro: 'Ação desconhecida.' }, { status: 400 })
}
