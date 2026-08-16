import 'dotenv/config'
import crypto from 'crypto'
import { createAdminClient } from '../lib/supabase/admin'
import { salvarConfigCanal, lerConfigParaTela, limparCredencial } from '../lib/channels/salvar-config'
import { getChannelCredentials, invalidateChannelCache } from '../lib/channels/config'

/* Webhook da Meta e guarda de credenciais. Rodar com: npm run check:meta
   (o servidor de dev precisa estar no ar)

   NÃO chama a OpenAI de forma direta.

   Duas coisas estão sendo protegidas aqui:

   1. O ENDPOINT. Sem assinatura válida, qualquer um poderia postar mensagens
      que rodam agente (custa dinheiro) e escrevem no banco. E sem verify token,
      qualquer um poderia registrar este endereço no app dele e passar a receber
      as mensagens dos nossos clientes.
   2. A CREDENCIAL EM REPOUSO. O que a tela de Canais vai gravar precisa ficar
      cifrado no banco — um SELECT não pode devolver token legível, e a leitura
      para tela não pode devolver o segredo. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const supabase = createAdminClient()

const VERIFY = 'verify-token-de-teste-' + Date.now()
const SECRET = 'app-secret-de-teste-' + Date.now()
const TOKEN = 'EAAG-token-de-acesso-falso-' + Date.now()

let haviaLinha = false
const telefonesCriados = ['5511977004001']

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

async function limpar() {
  /* Só remove a linha se ELA NÃO EXISTIA antes do teste: apagar uma
     configuração real que o usuário tenha preenchido derrubaria o canal. */
  if (!haviaLinha) {
    await supabase.from('channel_configs').delete().eq('channel', 'meta')
  }
  invalidateChannelCache('meta')

  for (const t of telefonesCriados) {
    const { data } = await supabase.from('contacts').select('id').eq('phone', t)
    for (const c of data ?? []) {
      const { error } = await supabase.from('contacts').delete().eq('id', c.id)
      if (error) throw new Error(`limpeza do contato falhou: ${error.message}`)
    }
  }
}

function payloadMeta(messageId: string, telefone: string, texto: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '000000',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '111111' },
              contacts: [{ wa_id: telefone, profile: { name: 'Cliente Meta Teste' } }],
              messages: [
                {
                  id: messageId,
                  from: telefone,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: texto },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

function assinar(corpo: string, segredo: string) {
  return 'sha256=' + crypto.createHmac('sha256', segredo).update(corpo).digest('hex')
}

async function postar(corpo: unknown, assinatura?: string) {
  const bruto = JSON.stringify(corpo)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (assinatura) headers['x-hub-signature-256'] = assinatura
  const r = await fetch(`${BASE}/api/webhook/meta`, { method: 'POST', headers, body: bruto })
  return { status: r.status, corpo: await r.json().catch(() => ({})) }
}

async function main() {
  const { data: existente } = await supabase
    .from('channel_configs')
    .select('channel')
    .eq('channel', 'meta')
    .maybeSingle()
  haviaLinha = Boolean(existente)

  if (haviaLinha) {
    console.log('AVISO já existe configuração da Meta no banco — o teste não vai apagá-la,')
    console.log('      mas vai sobrescrevê-la. Rode com o canal ainda não configurado.\n')
    process.exit(1)
  }

  await limpar()

  // ================= Credencial em repouso =================
  console.log('--- Credencial gravada pela tela ---')

  const salvou = await salvarConfigCanal(
    'meta',
    { isActive: true, displayName: 'Teste Meta', phoneId: '111111', accessToken: TOKEN, appSecret: SECRET, verifyToken: VERIFY },
    undefined
  )
  ok('salvou a configuração', salvou.ok === true, JSON.stringify(salvou))

  const { data: linhaCrua } = await supabase
    .from('channel_configs')
    .select('*')
    .eq('channel', 'meta')
    .single()

  const bruto = JSON.stringify(linhaCrua)

  /* O ponto central: um SELECT na tabela não pode devolver o token. Se estas
     três falharem, a credencial está em claro no banco e um dump de backup a
     entrega inteira. */
  ok('token de acesso NÃO está legível no banco', !bruto.includes(TOKEN))
  ok('app secret NÃO está legível no banco', !bruto.includes(SECRET))
  ok('verify token NÃO está legível no banco', !bruto.includes(VERIFY))
  ok(
    'as colunas cifradas estão preenchidas',
    Boolean(linhaCrua!.access_token_encrypted && linhaCrua!.app_secret_encrypted && linhaCrua!.verify_token_encrypted)
  )

  const naTela = await lerConfigParaTela('meta')
  const brutoTela = JSON.stringify(naTela)
  ok('a leitura para tela NÃO devolve segredo', !brutoTela.includes(TOKEN) && !brutoTela.includes(SECRET))
  ok('mas diz que está configurado', naTela.segredos.accessToken.configurado === true)
  ok(
    'e mostra os últimos 4 para reconhecer qual é',
    naTela.segredos.accessToken.mascara.endsWith(TOKEN.slice(-4)),
    naTela.segredos.accessToken.mascara
  )

  const decifrada = await getChannelCredentials('meta')
  ok('o servidor decifra corretamente', decifrada.accessToken === TOKEN && decifrada.appSecret === SECRET)

  /* Formulário HTML manda '' para campo não preenchido. Se isso apagasse, a
     credencial morreria ao salvar qualquer outro campo da tela. */
  await salvarConfigCanal('meta', { displayName: 'Nome trocado', accessToken: '', appSecret: '' })
  const depoisDeVazio = await getChannelCredentials('meta')
  ok('campo em branco NÃO apaga a credencial', depoisDeVazio.accessToken === TOKEN)
  ok('e o campo comum foi atualizado', (await lerConfigParaTela('meta')).displayName === 'Nome trocado')

  // ================= Verificação (GET) =================
  console.log('\n--- Verificação do endpoint ---')

  const desafio = 'desafio-' + Date.now()

  const errado = await fetch(
    `${BASE}/api/webhook/meta?hub.mode=subscribe&hub.verify_token=token-errado&hub.challenge=${desafio}`
  )
  ok('verify token errado é recusado', errado.status === 403, `status ${errado.status}`)

  const certo = await fetch(
    `${BASE}/api/webhook/meta?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(VERIFY)}&hub.challenge=${desafio}`
  )
  const corpoCerto = await certo.text()
  ok('verify token certo é aceito', certo.status === 200, `status ${certo.status}`)
  /* A Meta espera o desafio cru. Devolver JSON reprova a verificação sem
     explicar por quê — erro caro de diagnosticar no painel deles. */
  ok('devolve o desafio como texto puro', corpoCerto === desafio, corpoCerto.slice(0, 40))

  const semParametros = await fetch(`${BASE}/api/webhook/meta`)
  ok('GET sem parâmetros é recusado', semParametros.status === 400, `status ${semParametros.status}`)

  // ================= Assinatura (POST) =================
  console.log('\n--- Assinatura do corpo ---')

  const telefone = telefonesCriados[0]
  const carimbo = Date.now()
  const corpo = payloadMeta(`wamid-${carimbo}`, telefone, 'Oi, queria alugar um apartamento.')

  const semAssinatura = await postar(corpo)
  ok('POST sem assinatura é recusado', semAssinatura.status === 401, `status ${semAssinatura.status}`)

  const assinaturaErrada = await postar(corpo, assinar(JSON.stringify(corpo), 'segredo-errado'))
  ok('POST com assinatura de outro segredo é recusado', assinaturaErrada.status === 401)

  /* Corpo alterado depois de assinado: é o caso de alguém interceptar uma
     entrega legítima e trocar o texto da mensagem. */
  const adulterado = payloadMeta(`wamid-${carimbo}`, telefone, 'texto trocado no meio do caminho')
  const comAssinaturaDoOutro = await postar(adulterado, assinar(JSON.stringify(corpo), SECRET))
  ok('corpo adulterado depois de assinado é recusado', comAssinaturaDoOutro.status === 401)

  const { count: nadaGravado } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'meta')
    .ilike('content', '%texto trocado no meio%')
  ok('nenhuma mensagem recusada chegou ao banco', nadaGravado === 0, `${nadaGravado}`)

  // ================= Entrega válida =================
  console.log('\n--- Entrega válida ---')

  const valida = await postar(corpo, assinar(JSON.stringify(corpo), SECRET))
  ok('assinatura correta é aceita', valida.status === 200, JSON.stringify(valida.corpo))

  const { data: contato } = await supabase
    .from('contacts')
    .select('id, name')
    .eq('phone', telefone)
    .maybeSingle()
  ok('contato criado a partir do wa_id', Boolean(contato))
  ok('nome do perfil aproveitado', contato?.name === 'Cliente Meta Teste', contato?.name ?? '')

  const { data: msgs } = await supabase
    .from('messages')
    .select('content, channel')
    .eq('contact_id', contato!.id)
  ok('mensagem gravada no canal meta', msgs?.length === 1 && msgs[0].channel === 'meta', `${msgs?.length}`)

  const repetida = await postar(corpo, assinar(JSON.stringify(corpo), SECRET))
  ok('reentrega do mesmo id é descartada', repetida.corpo.mensagens?.[0] === 'duplicado', JSON.stringify(repetida.corpo))

  /* A Meta manda status de entrega e leitura pelo MESMO endpoint. Precisa de
     200 — não-2xx repetido faz a Meta desativar o webhook. */
  const statusApenas = {
    object: 'whatsapp_business_account',
    entry: [{ id: '1', changes: [{ field: 'messages', value: { statuses: [{ id: 'x', status: 'delivered' }] } }] }],
  }
  const soStatus = await postar(statusApenas, assinar(JSON.stringify(statusApenas), SECRET))
  ok('evento de status responde 200', soStatus.status === 200 && soStatus.corpo.status === 'sem_mensagens', JSON.stringify(soStatus.corpo))

  // ================= Apagar de propósito =================
  console.log('\n--- Remoção explícita ---')

  await limparCredencial('meta', 'accessToken')
  const depoisDeLimpar = await getChannelCredentials('meta')
  ok('limparCredencial apaga de fato', !depoisDeLimpar.accessToken)

  await limpar()
  console.log('\nDados de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})
