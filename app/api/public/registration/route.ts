import { NextResponse } from 'next/server'
import { submeterCadastro } from '@/lib/registrations/form'
import type { DadosCadastro } from '@/lib/registrations/form'

/* Rota publica de submissao do cadastro (PRD 16). O token e a credencial —
   nao ha sessao. Toda validacao roda no servidor: o que o navegador valida e
   conveniencia, nao garantia. */

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let corpo: { token?: string; dados?: DadosCadastro }

  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  if (!corpo.token || !corpo.dados) {
    return NextResponse.json({ erro: 'Requisição incompleta.' }, { status: 400 })
  }

  try {
    const resultado = await submeterCadastro(corpo.token, corpo.dados)

    if (resultado.ok === true) {
      return NextResponse.json({ ok: true })
    }

    if (resultado.ok === 'revisao') {
      return NextResponse.json({ ok: true, revisao: true, mensagem: resultado.mensagem })
    }

    return NextResponse.json(
      { erro: resultado.erro, campo: resultado.campo },
      { status: 400 }
    )
  } catch (e) {
    /* Nunca deixar o erro cru vazar para o cliente: a mensagem do Postgres
       poderia revelar estrutura de tabela ou constraint. */
    console.error('[api/public/registration] falha:', (e as Error).message)
    return NextResponse.json({ erro: 'Erro ao processar o cadastro.' }, { status: 500 })
  }
}
