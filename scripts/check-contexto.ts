import { montarContextoConversa, resumoParaRoteador, type LinhaConversa } from '../lib/pipeline/contexto-conversa'
import { removerLinksInventados } from '../lib/agents/base-agent'

/* Contexto da conversa inteira entre agentes. Rodar com: npm run check:contexto

   NÃO chama a OpenAI nem o banco — exercita só a parte pura.

   O que está sendo protegido: em produção o SDR mandou o link do LH-1001, a
   pessoa perguntou "que dia eu consigo visitar?", o roteador passou para o
   Agendamento e ele — com histórico próprio vazio — respondeu "qual é o imóvel
   que você gostaria de visitar?". A memória por agente existia, mas o segundo
   agente não enxergava a do primeiro. */

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

const LINK_IMOVEL = 'https://lovehome.exemplo.com/imoveis/LH-1001'
const LINK_CADASTRO = 'https://lovehome.exemplo.com/cadastro/abc123'

function linha(
  role: LinhaConversa['role'],
  content: string,
  agent: string | null = null,
  minuto = 0
): LinhaConversa {
  return { role, content, agent, created_at: new Date(Date.UTC(2026, 7, 17, 16, minuto)).toISOString() }
}

function main() {
  // ================= Cenário do print =================
  console.log('--- SDR mostrou o imóvel, Agendamento assume ---')

  const conversa: LinhaConversa[] = [
    linha('user', 'Oi, procuro apartamento na Vila Mariana', null, 10),
    linha('assistant', `Tenho o LH-1001, 2 dorms, 68m², R$ 850 mil.\n${LINK_IMOVEL}`, 'sdr', 11),
    linha('user', 'O link não veio', null, 20),
    linha('assistant', `Aqui está:\n${LINK_IMOVEL}`, 'sdr', 20),
    linha('user', 'Que dia eu consigo visitar?', null, 38),
  ]

  const ctx = montarContextoConversa(conversa, 'Que dia eu consigo visitar?')

  ok('o turno atual não entra no bloco', ctx.total === 4, `total=${ctx.total}`)
  ok('o bloco cita o imóvel que o SDR mostrou', ctx.bloco.includes('LH-1001'))
  ok('o bloco identifica quem falou', ctx.bloco.includes('LoveHome (agente sdr)') && ctx.bloco.includes('Cliente:'))
  ok('ordem cronológica: primeira mensagem do cliente vem antes da resposta', ctx.bloco.indexOf('procuro apartamento') < ctx.bloco.indexOf('LH-1001'))
  ok('horário em São Paulo (16:10 UTC → 13:10)', ctx.bloco.includes('[17/08 13:10]'), ctx.bloco.split('\n').find((l) => l.startsWith('[')) ?? '')
  ok('link do imóvel entra como URL já enviada', ctx.urlsEnviadas.includes(LINK_IMOVEL), ctx.urlsEnviadas.join(', '))
  ok('cadastro ainda não foi enviado', ctx.cadastroJaEnviado === false)

  // ---- Versão compacta para o roteador ----
  const resumo = resumoParaRoteador(ctx)
  ok('o resumo do roteador tem no máximo 5 linhas', resumo.split('\n').length <= 5, `${resumo.split('\n').length} linhas`)
  ok('cada linha do resumo é curta (≤121 chars)', resumo.split('\n').every((l) => l.length <= 121))
  ok('o resumo preserva o rótulo de quem falou', resumo.includes('Cliente:'))
  ok('resumo de contexto vazio diz que é a primeira mensagem',
    resumoParaRoteador({ conversationId: null, bloco: '', urlsEnviadas: [], cadastroJaEnviado: false, total: 0 }).includes('primeira mensagem'))

  // Repetir o link que o SDR mandou não é inventar.
  const resposta = `Claro! É o apê da Vila Mariana, né? ${LINK_IMOVEL}\nTenho quinta às 10h ou sexta de manhã.`
  const filtrado = removerLinksInventados(resposta, ctx.urlsEnviadas)
  ok('o filtro de link inventado mantém a URL já enviada pela equipe', filtrado.texto.includes(LINK_IMOVEL) && filtrado.removidos.length === 0, filtrado.removidos.join(', '))

  const inventado = removerLinksInventados('Veja https://www.lovehome.com.br/imovel/LH-1001', ctx.urlsEnviadas)
  ok('URL que nunca foi enviada continua sendo removida', inventado.removidos.length === 1)

  // ================= Link de cadastro entre agentes =================
  console.log('\n--- Cadastro já enviado por outro agente ---')

  const comCadastro = montarContextoConversa(
    [
      ...conversa.slice(0, 4),
      linha('assistant', `Pra confirmar preciso do seu cadastro:\n${LINK_CADASTRO}`, 'sdr', 21),
      linha('user', 'Que dia eu consigo visitar?', null, 38),
    ],
    'Que dia eu consigo visitar?'
  )
  ok('detecta que o cadastro já foi enviado (por outro agente)', comCadastro.cadastroJaEnviado === true)

  // ================= URL mandada pelo CLIENTE não vira confiável =================
  console.log('\n--- URL do cliente não é fonte confiável ---')

  const clienteComLink = montarContextoConversa(
    [linha('user', 'Vi esse aqui https://golpe.exemplo.com/oferta', null, 1), linha('assistant', 'Não é nosso.', 'sdr', 2), linha('user', 'ok', null, 3)],
    'ok'
  )
  ok('URL enviada pelo cliente fica fora de urlsEnviadas', !clienteComLink.urlsEnviadas.some((u) => u.includes('golpe')), clienteComLink.urlsEnviadas.join(', '))

  // ================= Rajada (debounce) e turno anterior sem resposta =================
  console.log('\n--- Turno atual em rajada; turno antigo sem resposta fica ---')

  const rajada = montarContextoConversa(
    [
      linha('user', 'Oi', null, 1),
      linha('assistant', 'Oi! Como posso ajudar?', 'sdr', 1),
      linha('user', 'mensagem que ficou sem resposta ontem', null, 2),
      linha('user', 'Quero', null, 30),
      linha('user', 'agendar visita', null, 30),
    ],
    'Quero\nagendar visita'
  )
  ok('as duas mensagens da rajada saem do bloco', !rajada.bloco.includes('agendar visita') && !rajada.bloco.includes('] Cliente: Quero'))
  ok('a mensagem antiga sem resposta continua no bloco', rajada.bloco.includes('sem resposta ontem'))

  // ================= Vazio e rótulos =================
  console.log('\n--- Casos de borda ---')

  const vazio = montarContextoConversa([linha('user', 'oi', null, 1)], 'oi')
  ok('primeira mensagem da pessoa: bloco vazio', vazio.bloco === '' && vazio.total === 0)

  const humano = montarContextoConversa([linha('user', 'alô', null, 1), linha('assistant', 'Oi, aqui é o Marcos', 'humano', 2), linha('assistant', 'Ainda tem interesse?', 'followup', 3), linha('user', 'sim', null, 4)], 'sim')
  ok('corretor humano e follow-up são rotulados', humano.bloco.includes('Corretor da LoveHome (humano)') && humano.bloco.includes('follow-up automático'))

  const longa = montarContextoConversa([linha('user', 'x'.repeat(2000), null, 1), linha('assistant', 'ok', 'sdr', 2), linha('user', 'e aí', null, 3)], 'e aí')
  ok('mensagem longa é cortada', !longa.bloco.includes('x'.repeat(900)) && longa.bloco.includes('…'))

  const muitas = montarContextoConversa(
    Array.from({ length: 80 }, (_, i) => linha(i % 2 ? 'assistant' : 'user', `msg ${i}`, i % 2 ? 'sdr' : null, i)),
    'não bate com nada'
  )
  ok('respeita o teto de 30 mensagens', muitas.total === 30, `total=${muitas.total}`)
  ok('com teto, fica com as mais recentes', muitas.bloco.includes('msg 79') && !muitas.bloco.includes('msg 49 '))

  console.log(process.exitCode ? '\nHouve falhas.' : '\nTudo certo.')
}

main()
