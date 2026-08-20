import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { avaliarVisitas, PROMPT_FOLLOWUP } from '../lib/followup/runner'
import { descreverQuando, instanteLocal } from '../lib/agenda/fuso'

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

  // ================= Datas e visitas: o modelo recebe a conclusão pronta =================
  console.log('\n--- Follow-up ciente de data e de visita ---')

  /* O caso real que motivou isto: visita marcada para terça 18/08 às 10h; às
     19h da PRÓPRIA terça o follow-up perguntou "ainda vai conseguir visitar
     amanhã às 10h?" — o "amanhã" veio de mensagem antiga, e nada dizia ao
     modelo que dia era hoje. Instantes construídos em fuso local para o teste
     não depender do relógio da máquina nem do UTC do servidor. */
  const visita10h = instanteLocal(2026, 8, 18, 10, 0)
  const terca19h = instanteLocal(2026, 8, 18, 19, 0)
  const segunda19h = instanteLocal(2026, 8, 17, 19, 0)
  const sexta = instanteLocal(2026, 8, 21, 9, 0)

  ok(
    'no dia da visita, à noite: "hoje" e "JÁ PASSOU"',
    descreverQuando(visita10h, terca19h) === 'hoje às 10:00 (esse horário JÁ PASSOU)',
    descreverQuando(visita10h, terca19h)
  )
  ok(
    'na véspera: "amanhã" com o dia certo',
    descreverQuando(visita10h, segunda19h).startsWith('amanhã (terça-feira, 18/08)'),
    descreverQuando(visita10h, segunda19h)
  )
  ok(
    'dias depois: passado explícito, sem "amanhã"',
    descreverQuando(visita10h, sexta).includes('há 3 dias'),
    descreverQuando(visita10h, sexta)
  )
  /* Meia-noite de Brasília é 03:00 UTC — se alguém trocar o cálculo para
     toISOString, este caso quebra na hora. */
  const quaseMeiaNoite = instanteLocal(2026, 8, 18, 23, 30)
  ok(
    'às 23h30 de Brasília ainda é "hoje" (não o dia do UTC)',
    descreverQuando(instanteLocal(2026, 8, 18, 23, 45), quaseMeiaNoite).startsWith('hoje'),
    descreverQuando(instanteLocal(2026, 8, 18, 23, 45), quaseMeiaNoite)
  )

  const visitaTerca = {
    scheduled_at: visita10h.toISOString(),
    status: 'agendada',
    codigo: 'LH-1001',
    regiao: 'Vila Mariana',
  }

  const naVespera = avaliarVisitas([visitaTerca], segunda19h)
  ok('véspera → modo pre_visita', naVespera?.modo === 'pre_visita', JSON.stringify(naVespera))
  ok('e a frase carrega o "amanhã" calculado', Boolean(naVespera?.frase.includes('amanhã')), naVespera?.frase ?? '')

  const naNoiteDaVisita = avaliarVisitas([visitaTerca], terca19h)
  /* A asserção do bug: às 19h do dia da visita, o modo é pós-visita — a
     mensagem certa é "como foi?", nunca "confirmado para amanhã?". */
  ok('noite do próprio dia → modo pos_visita', naNoiteDaVisita?.modo === 'pos_visita', JSON.stringify(naNoiteDaVisita))
  ok('e a frase diz que JÁ PASSOU', Boolean(naNoiteDaVisita?.frase.includes('JÁ PASSOU')), naNoiteDaVisita?.frase ?? '')
  ok('a frase identifica o imóvel', Boolean(naNoiteDaVisita?.frase.includes('LH-1001')))

  const muitoDepois = avaliarVisitas([visitaTerca], instanteLocal(2026, 8, 25, 10, 0))
  ok('visita de uma semana atrás não vira pós-visita', muitoDepois === null, JSON.stringify(muitoDepois))

  const cancelada = avaliarVisitas([{ ...visitaTerca, status: 'cancelada' }], segunda19h)
  ok('visita cancelada não gera confirmação', cancelada === null)

  const realizada = avaliarVisitas([{ ...visitaTerca, status: 'realizada' }], terca19h)
  ok('visita já marcada como realizada não gera pós-visita duplicado', realizada === null)

  ok(
    'o prompt do follow-up proíbe calcular data por conta própria',
    /NUNCA escreva "hoje", "amanhã"/.test(PROMPT_FOLLOWUP),
    'regra de datas ausente do prompt'
  )


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
