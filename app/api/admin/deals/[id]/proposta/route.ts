import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { escopoProprio } from '@/lib/auth/permissions'
import { negocioDaCarteira } from '@/lib/auth/carteira'
import { aceitarProposta, desfazerNegocio, recusarProposta } from '@/lib/negocios/propostas'

/* Decisão sobre proposta e sobre negócio aceito que não vai adiante.
 *
 * `contratos` + `editar`, o mesmo portão da aprovação (§15.2): aceitar uma
 * proposta reserva o imóvel e dispara coleta de documento — é decisão de
 * negócio, não de triagem. A regra vive em lib/negocios/propostas; aqui só se
 * liga sessão, carteira e corpo. */

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('contratos', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params
  const recorte = await negocioDaCarteira(id, auth.sessao)
  if (!recorte.ok) return NextResponse.json({ erro: recorte.erro }, { status: recorte.status })

  let corpo: { acao?: 'aceitar' | 'recusar' | 'desfazer'; motivo?: string; avisar_cliente?: boolean }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const autor = { brokerId: auth.sessao.brokerId, recorteProprio: escopoProprio(auth.sessao.role) }
  const avisar = corpo.avisar_cliente !== false

  if (corpo.acao === 'aceitar') {
    const r = await aceitarProposta({ dealId: id, autor, avisarCliente: avisar })
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
    console.log(`[deals/proposta] ${auth.sessao.email} aceitou a proposta ${id}`)
    return NextResponse.json({ ok: true, aviso: r.aviso })
  }

  if (corpo.acao === 'recusar') {
    const r = await recusarProposta({ dealId: id, autor, motivo: corpo.motivo, avisarCliente: avisar })
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
    console.log(`[deals/proposta] ${auth.sessao.email} recusou a proposta ${id}`)
    return NextResponse.json({ ok: true, aviso: r.aviso })
  }

  if (corpo.acao === 'desfazer') {
    const r = await desfazerNegocio({ dealId: id, autor, motivo: corpo.motivo ?? '', avisarCliente: avisar })
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
    console.log(`[deals/proposta] ${auth.sessao.email} desfez o negócio ${id}: ${corpo.motivo}`)
    return NextResponse.json({ ok: true, aviso: r.aviso, propostas_na_fila: r.propostasNaFila })
  }

  return NextResponse.json({ erro: 'Ação desconhecida.' }, { status: 400 })
}
