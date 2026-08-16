import { NextResponse } from 'next/server'
import { rodarFollowups } from '@/lib/followup/runner'
import { timingSafeEqual } from '@/lib/crypto/encrypt'

/* Cron de follow-up (PRD 13.3). Agendado em vercel.json: 13h, 18h e 22h UTC,
   que caem às 10h, 15h e 19h em Brasília — dentro da janela civilizada que o
   runner também valida por conta própria, para o caso de alguém disparar
   manualmente fora de hora. */

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET

  if (!secret) {
    console.error('[cron/followup] CRON_SECRET não configurado — rota recusada')
    return NextResponse.json({ error: 'não configurado' }, { status: 503 })
  }

  const header = request.headers.get('authorization') ?? ''
  const enviado = header.replace(/^Bearer\s+/i, '')

  // Comparação em tempo constante: comparar segredo com === vaza informação
  // pelo tempo de resposta.
  if (!enviado || !timingSafeEqual(enviado, secret)) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
  }

  try {
    const resultado = await rodarFollowups()
    console.log('[cron/followup]', JSON.stringify(resultado))
    return NextResponse.json({ ok: true, ...resultado })
  } catch (e) {
    console.error('[cron/followup] falhou:', (e as Error).message)
    return NextResponse.json({ error: 'falha ao executar' }, { status: 500 })
  }
}
