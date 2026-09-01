import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { reenviarEnvioCrm } from '@/lib/crm/webhook'

/* Reenvio de um webhook de lead que falhou. Mesmo payload guardado, assinado
   com o segredo atual, para a URL atual — o caso típico é corrigir a URL na
   tela e reenviar o que ficou para trás. `canais` + `editar`, como o resto da
   tela. */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('canais', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params
  const r = await reenviarEnvioCrm(id)

  if (r.erro) return NextResponse.json({ erro: r.erro }, { status: r.status ?? 500 })
  console.log(`[crm] ${auth.sessao.email} reenviou o webhook ${id}: ${r.enviado ? 'ok' : r.motivo}`)
  return NextResponse.json({ ok: true, enviado: r.enviado, http_status: r.httpStatus ?? null, motivo: r.motivo ?? null })
}
