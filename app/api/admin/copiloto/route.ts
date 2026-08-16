import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { escopoProprio, recursosVisiveis } from '@/lib/auth/permissions'
import { responderCopiloto, type MensagemCopiloto } from '@/lib/agents/copiloto'

/* Copiloto do Corretor (PRD 12.8).
 *
 * O escopo é montado AQUI, a partir da sessão, e entregue pronto ao agente. O
 * corpo da requisição não tem — nem pode ter — como influenciar qual carteira
 * será consultada: é a diferença entre um assistente interno e um endpoint que
 * lê o banco inteiro para quem souber pedir.
 *
 * A §16 lista este endpoint como GET; virou POST porque a pergunta e o histórico
 * vão no corpo. Pergunta em query string acabaria em log de acesso, e o
 * histórico não caberia.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_PERGUNTA = 2000

export async function POST(request: Request) {
  const auth = await autorizarApi('copiloto')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  let corpo: { pergunta?: string; historico?: MensagemCopiloto[] }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const pergunta = corpo.pergunta?.trim()
  if (!pergunta) return NextResponse.json({ erro: 'Escreva uma pergunta.' }, { status: 400 })
  if (pergunta.length > MAX_PERGUNTA) {
    return NextResponse.json({ erro: 'Pergunta longa demais.' }, { status: 400 })
  }

  /* Só as duas formas que o agente entende. Papel desconhecido vindo do corpo
     seria mensagem forjada entrando no prompt como se fosse do sistema. */
  const historico = (corpo.historico ?? [])
    .filter((m) => m?.role === 'user' || m?.role === 'assistant')
    .filter((m) => typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_PERGUNTA) }))

  /* corretor → só a carteira dele. admin/viewer → operação inteira.
     Mesmo recorte da §9.3 usado pelas telas. */
  const escopo = {
    brokerId: escopoProprio(auth.sessao.role) ? auth.sessao.brokerId : null,
    nome: auth.sessao.nome || auth.sessao.email,
    /* QUAIS ferramentas o modelo recebe sai daqui, da matriz da §9.2 — não do
       corpo da requisição e não do prompt. Um editor pergunta do acervo e não
       alcança inadimplência porque a tool de pagamentos nem chega a existir
       para a sessão dele. */
    recursos: recursosVisiveis(auth.sessao.role),
  }

  /* Corretor sem cadastro em `brokers` cairia em brokerId null e passaria a
     enxergar a operação inteira — falha aberta, exatamente o contrário do que
     o escopo existe para fazer. */
  if (escopoProprio(auth.sessao.role) && !escopo.brokerId) {
    return NextResponse.json(
      { erro: 'Sua conta ainda não está vinculada a um cadastro de corretor. Fale com um administrador.' },
      { status: 409 }
    )
  }

  try {
    const r = await responderCopiloto(escopo, pergunta, historico)
    console.log(
      `[copiloto] ${auth.sessao.email} — tools: ${r.toolsUsadas.join(', ') || 'nenhuma'} (${r.tokens} tokens)`
    )
    return NextResponse.json({ resposta: r.content, tools: r.toolsUsadas })
  } catch (e) {
    console.error('[copiloto] falhou:', e)
    return NextResponse.json({ erro: 'Não consegui responder agora. Tente de novo.' }, { status: 500 })
  }
}
