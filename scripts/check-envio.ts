import 'dotenv/config'
import { sendFractioned } from '../lib/whatsapp/sender'

/* Envio real pelo Z-API. Rodar com: npm run check:envio
   NÃO chama a OpenAI. NÃO precisa do servidor de dev.

   ESTE SCRIPT MANDA MENSAGEM DE VERDADE, para o número em
   TESTE_WHATSAPP_NUMERO (fica no .env, que está no gitignore — número de
   pessoa real não entra em arquivo do repositório).

   Sem essa variável ele se recusa a rodar, em vez de cair num default: um
   default aqui vira mensagem indo para o telefone errado, e não existe desfazer.

   Por que existe: até as credenciais chegarem, todo o pipeline era exercitável
   menos o último passo. `sendFractioned` é o ponto onde a resposta do agente
   vira mensagem no celular de alguém, e é o único que nenhum outro check cobre. */

const numero = process.env.TESTE_WHATSAPP_NUMERO?.trim()

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

async function statusDaInstancia() {
  const url = `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/status`
  const r = await fetch(url, {
    headers: { 'Client-Token': process.env.ZAPI_CLIENT_TOKEN ?? '' },
  })
  return { http: r.status, corpo: (await r.json()) as Record<string, unknown> }
}

async function main() {
  const faltando = ['ZAPI_INSTANCE', 'ZAPI_TOKEN', 'ZAPI_CLIENT_TOKEN'].filter(
    (k) => !process.env[k]?.trim()
  )
  if (faltando.length) {
    console.error(`erro: credenciais ausentes no .env: ${faltando.join(', ')}`)
    process.exit(1)
  }

  if (!numero) {
    console.error(
      'erro: defina TESTE_WHATSAPP_NUMERO no .env com o número que deve receber o teste.\n' +
        'Sem isso o script não envia nada — não existe destinatário padrão seguro.'
    )
    process.exit(1)
  }

  console.log(`--- Instância Z-API ---`)
  const status = await statusDaInstancia()
  console.log(`INFO  ${JSON.stringify(status.corpo)}`)

  ok('a API respondeu', status.http === 200, `HTTP ${status.http}`)

  /* `connected: false` significa celular desconectado do Z-API. Vale parar
     aqui: o envio devolveria erro e a mensagem de falha não diria o motivo. */
  const conectado = status.corpo.connected === true
  ok('instância conectada ao WhatsApp', conectado, JSON.stringify(status.corpo))
  if (!conectado) {
    console.log('\nReconecte a instância no painel do Z-API e rode de novo.')
    return
  }

  console.log(`\n--- Envio para ${numero.slice(0, 4)}****${numero.slice(-4)} ---`)

  /* Duas partes de propósito: `sendFractioned` quebra por parágrafo e é assim
     que a resposta do agente chega — em mensagens curtas seguidas, não num
     bloco só. Testar com uma parte só não exercitaria o fracionamento. */
  const texto = `Teste do LoveHome — a integração com o Z-API está funcionando.

Esta é a segunda parte da mesma resposta: é assim que o agente conversa, em mensagens curtas seguidas.`

  const inicio = Date.now()
  try {
    await sendFractioned(numero, texto)
    const levou = Date.now() - inicio
    ok('envio fracionado concluiu', true)
    /* 3s de pausa entre partes: duas partes = ao menos 3s. Se vier bem abaixo
       disso, o fracionamento parou de pausar e as mensagens chegam empilhadas. */
    ok('respeitou a pausa entre as partes', levou >= 3000, `${levou}ms`)
  } catch (e) {
    ok('envio fracionado concluiu', false, (e as Error).message)
  }

  // ================= Trava de destinatário =================
  console.log('\n--- Trava de desenvolvimento ---')

  const allowlist = (process.env.WHATSAPP_ALLOWLIST ?? '').trim()
  ok('WHATSAPP_ALLOWLIST está preenchida', Boolean(allowlist), 'vazia — TODOS os números receberiam')

  if (allowlist) {
    /* O telefone de um lead fictício dos testes. Se este envio PASSAR, qualquer
       rodada de check:webhook volta a mandar mensagem para um número que pode
       ser de alguém de verdade. */
    const foraDaLista = '5511977001234'
    let bloqueou = false
    try {
      await sendFractioned(foraDaLista, 'Se esta mensagem chegou, a trava falhou.')
    } catch (e) {
      bloqueou = /allowlist/i.test((e as Error).message)
    }
    ok('número fora da allowlist é recusado', bloqueou)

    /* Mesmo telefone, escrito como uma pessoa escreveria. Trava que erra por
       formatação não serve como trava. */
    const formatado = `+${numero.slice(0, 2)} ${numero.slice(2, 4)} ${numero.slice(4, 9)}-${numero.slice(9)}`
    let passou = false
    try {
      await sendFractioned(formatado, 'Teste do LoveHome — número formatado reconhecido pela allowlist.')
      passou = true
    } catch (e) {
      console.log(`INFO  ${(e as Error).message}`)
    }
    ok('reconhece o mesmo número com formatação diferente', passou, formatado)
  }

  console.log('\nConfira o celular: devem ter chegado três mensagens.')
}

main().catch((e) => {
  console.error('erro:', e.message ?? e)
  process.exit(1)
})
