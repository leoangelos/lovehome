import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'

/* Exercita o cron de follow-up. Rodar com: npm run check:followup
   (o servidor de dev precisa estar no ar)

   CHAMA A OPENAI se houver candidato elegível.

   Com ZAPI_INSTANCE/ZAPI_TOKEN vazios o envio falha — e isso é justamente o que
   permite testar a trava mais importante: canal fora do ar NÃO pode gastar as
   tentativas de follow-up da pessoa. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const supabase = createAdminClient()

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

async function chamar(token?: string) {
  const r = await fetch(`${BASE}/api/cron/followup`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return { status: r.status, corpo: await r.json() }
}

async function main() {
  // ---- Autenticação ----
  const semToken = await chamar()
  ok('recusa sem Authorization', semToken.status === 401, `status ${semToken.status}`)

  const tokenErrado = await chamar('token-errado-qualquer')
  ok('recusa com segredo errado', tokenErrado.status === 401, `status ${tokenErrado.status}`)

  const segredo = process.env.CRON_SECRET
  if (!segredo) throw new Error('CRON_SECRET não está no .env')

  // ---- Sem candidato ----
  const vazio = await chamar(segredo)
  ok('autoriza com o segredo correto', vazio.status === 200, `status ${vazio.status}`)
  console.log(`INFO  ${JSON.stringify(vazio.corpo)}`)

  if (vazio.corpo.foraDeHorario) {
    console.log('\nFora da janela de 9h–20h em Brasília — o resto do teste não se aplica agora.')
    return
  }

  // ---- Candidato elegível ----
  /* Escolhe um lead do seed que já tenha histórico de conversa (os testes de
     agente deixam histórico) e envelhece o last_contact para 30h atrás. */
  const { data: comHistorico } = await supabase
    .from('agent_histories')
    .select('contact_id')
    .limit(20)

  const ids = [...new Set((comHistorico ?? []).map((h) => h.contact_id))]
  const { data: candidatos } = await supabase
    .from('contacts')
    .select('id, name, phone, followup_count, last_contact, channel_default')
    .in('id', ids)
    .not('phone', 'is', null)
    .like('phone', '5511900%')
    .limit(1)

  const alvo = candidatos?.[0]
  if (!alvo) {
    console.log('\nINFO  nenhum lead do seed com histórico — rode npm run check:agents antes.')
    return
  }

  const estadoOriginal = { last_contact: alvo.last_contact, followup_count: alvo.followup_count }

  // Garante uma conversa aberta para o cron encontrar
  const { data: conversa } = await supabase
    .from('conversations')
    .select('id')
    .eq('contact_id', alvo.id)
    .eq('channel', alvo.channel_default)
    .limit(1)
    .maybeSingle()

  if (!conversa) {
    await supabase
      .from('conversations')
      .insert({ contact_id: alvo.id, channel: alvo.channel_default, status: 'active' })
  }

  const trintaHorasAtras = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString()
  await supabase
    .from('contacts')
    .update({ last_contact: trintaHorasAtras, followup_count: 0 })
    .eq('id', alvo.id)

  console.log(`\nINFO  ${alvo.name} envelhecido para 30h de silêncio`)

  const comCandidato = await chamar(segredo)
  ok('execução com candidato retorna 200', comCandidato.status === 200)
  console.log(`INFO  ${JSON.stringify(comCandidato.corpo)}`)

  ok(
    'candidato foi avaliado',
    comCandidato.corpo.avaliados > 0,
    `avaliados: ${comCandidato.corpo.avaliados}`
  )

  const { data: depois } = await supabase
    .from('contacts')
    .select('followup_count, last_contact, last_followup_at')
    .eq('id', alvo.id)
    .single()

  const falhaDeEnvio = (comCandidato.corpo.pulados ?? []).some(
    (p: { motivo: string }) => p.motivo === 'falha no envio'
  )

  if (falhaDeEnvio) {
    // Caminho esperado sem credenciais do Z-API.
    ok(
      'falha de envio NÃO consumiu a tentativa',
      depois!.followup_count === 0,
      `followup_count = ${depois!.followup_count}`
    )
  } else if (comCandidato.corpo.enviados > 0) {
    ok('tentativa contabilizada após envio', depois!.followup_count === 1)
    ok('last_followup_at registrado', Boolean(depois!.last_followup_at))
    ok(
      'last_contact preservado (marca o último sinal DA PESSOA)',
      depois!.last_contact === trintaHorasAtras,
      'o relógio de inatividade foi reiniciado — o 2º follow-up nunca chegaria'
    )
  }

  // ---- Restaura ----
  await supabase.from('contacts').update(estadoOriginal).eq('id', alvo.id)
  console.log('\nEstado do contato restaurado.')
}

main().catch((e) => {
  console.error('erro:', e.message ?? e)
  process.exit(1)
})
