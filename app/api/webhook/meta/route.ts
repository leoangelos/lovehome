// ==========================================
// Webhook da Meta (WhatsApp Cloud API) — camada fina sobre o pipeline
// unificado, espelhando o webhook do Z-API. As diferenças reais são quatro:
//
// 1. GET DE VERIFICAÇÃO. A Meta confirma a posse do endpoint mandando um
//    desafio que precisa ser devolvido cru.
// 2. ASSINATURA NO POST. Todo corpo vem com X-Hub-Signature-256, HMAC do corpo
//    BRUTO com o app secret. É a única coisa que separa uma mensagem real de
//    qualquer um postando aqui — e postar aqui custa dinheiro (LLM) e escreve
//    no banco.
// 3. MÍDIA É AUTENTICADA. A Meta manda um id, não uma URL; baixar exige duas
//    chamadas com o bearer token. Entregar a URL da Meta ao Whisper/Vision
//    falha com 401.
// 4. LOTE. Uma entrega pode trazer várias mensagens, de contatos diferentes.
//
// CREDENCIAIS VÊM DE `channel_configs`, cifradas (AES-256-GCM), com fallback
// para variável de ambiente enquanto a linha não existe. Nada aqui lê segredo
// em texto plano de lugar nenhum além do decifrador.
// ==========================================

import { NextResponse, after } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getChannelCredentials } from '@/lib/channels/config'
import { parseMetaIncoming, downloadMetaMedia, type MetaWebhookPayload } from '@/lib/channels/meta'
import { resolveContact, resolveConversation } from '@/lib/channels/identity'
import { isContactBlocked } from '@/lib/channels/blocklist'
import { transcribeAudioBuffer, analyzeImageBuffer } from '@/lib/whatsapp/media'
import { guardarDocumento, aguardandoDocumentos } from '@/lib/documentos/receber'
import { processMessage } from '@/lib/pipeline/process-message'
import { enqueueMessage, clearQueueLocks } from '@/lib/debounce/queue'
import { aguardarEProcessar } from '@/lib/debounce/runner'
import { redis } from '@/lib/redis/client'
import { extractPhoneKey } from '@/lib/utils/phone'
import type { IncomingMessage } from '@/lib/channels/types'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/* Comparação de tamanho constante. `crypto.timingSafeEqual` exige buffers do
   mesmo tamanho, então o comprimento é checado antes — e essa checagem não
   vaza nada útil, porque o tamanho do token não é o segredo. */
function comparaSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

// ==========================================================================
// GET — verificação de posse do endpoint
// ==========================================================================
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const creds = await getChannelCredentials('meta')

  /* Sem verify token configurado, NÃO passa. A alternativa — aceitar qualquer
     desafio enquanto ninguém configurou — deixaria qualquer pessoa registrar
     este endpoint no app dela e receber as mensagens dos nossos clientes. */
  if (!creds.verifyToken) {
    console.error('[Webhook/meta] verificação recusada: verify token não configurado')
    return new NextResponse('Canal não configurado', { status: 403 })
  }

  if (mode !== 'subscribe' || !token || !challenge) {
    return new NextResponse('Requisição inválida', { status: 400 })
  }

  if (!comparaSeguro(token, creds.verifyToken)) {
    console.error('[Webhook/meta] verificação recusada: token não confere')
    return new NextResponse('Token inválido', { status: 403 })
  }

  /* A Meta espera o desafio como TEXTO PURO. Devolver JSON reprova a
     verificação sem dizer por quê. */
  console.log('[Webhook/meta] endpoint verificado com sucesso')
  return new NextResponse(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

// ==========================================================================
// POST — mensagens
// ==========================================================================
export async function POST(req: Request) {
  try {
    // O corpo BRUTO é o que foi assinado. Reserializar o JSON muda bytes
    // (ordem de chaves, espaços) e a assinatura nunca mais confere.
    const rawBody = await req.text()

    const creds = await getChannelCredentials('meta')

    /* Sem app secret não há como validar assinatura. Recusar é a única opção
       defensável: aceitar não assinado transformaria a rota num endereço
       público que roda agente e grava no banco para quem souber a URL. */
    if (!creds.appSecret) {
      console.error('[Webhook/meta] POST recusado: app secret não configurado')
      return NextResponse.json({ error: 'Canal não configurado' }, { status: 403 })
    }

    const assinatura = req.headers.get('x-hub-signature-256')
    if (!assinatura) {
      console.error('[Webhook/meta] POST sem assinatura')
      return NextResponse.json({ error: 'Assinatura ausente' }, { status: 401 })
    }

    const esperada =
      'sha256=' + crypto.createHmac('sha256', creds.appSecret).update(rawBody).digest('hex')

    if (!comparaSeguro(assinatura, esperada)) {
      console.error('[Webhook/meta] assinatura inválida')
      return NextResponse.json({ error: 'Assinatura inválida' }, { status: 401 })
    }

    let payload: MetaWebhookPayload
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }

    const adminDb = createAdminClient()
    const { error: logErr } = await adminDb.from('webhook_logs').insert({
      payload,
      phone: null,
      event_type: 'meta',
    })
    if (logErr) console.log('[Webhook/meta] log ignorado:', logErr.message)

    const mensagens = parseMetaIncoming(payload)

    /* Entrega sem mensagem é o caso comum, não erro: a Meta manda status de
       entrega e leitura pelo mesmo endpoint. Precisa de 200 — status não-2xx
       repetido faz a Meta desativar o webhook. */
    if (!mensagens.length) {
      return NextResponse.json({ status: 'sem_mensagens' })
    }

    const resultados: string[] = []
    for (const incoming of mensagens) {
      resultados.push(await tratarMensagem(incoming))
    }

    return NextResponse.json({ status: 'ok', mensagens: resultados })
  } catch (error) {
    console.error('[Webhook/meta] erro:', error)
    /* 200 mesmo em erro interno: a Meta reentrega em não-2xx, e reentregar uma
       mensagem que já foi gravada duplica atendimento. O dedup cobre parte
       disso, mas a falha aqui já foi registrada e reprocessar não conserta. */
    return NextResponse.json({ status: 'erro_registrado' })
  }
}

async function tratarMensagem(incoming: IncomingMessage): Promise<string> {
  const adminDb = createAdminClient()

  // Dedup por messageId — a Meta reentrega em caso de timeout.
  const novo = await redis.set(`dedup:${incoming.messageId}`, '1', { ex: 300, nx: true })
  if (novo !== 'OK') return 'duplicado'

  /* Contato antes de qualquer mídia: bloqueado não pode chegar em transcrição
     nem em Vision, que são chamadas cobradas por token. */
  const contact = await resolveContact({
    channel: 'meta',
    externalId: incoming.externalId,
    phone: incoming.phone,
    phoneKey: incoming.phone ? extractPhoneKey(incoming.phone) : undefined,
    name: incoming.senderName,
  })

  const conversation = await resolveConversation(contact.id, 'meta')

  if (isContactBlocked(contact)) {
    console.log('[Webhook/meta] Contato bloqueado — grava cru, sem IA:', contact.id)
    await adminDb.from('messages').insert({
      conversation_id: conversation.id,
      contact_id: contact.id,
      role: 'user',
      content: incoming.content,
      media_type: incoming.messageType,
      channel: 'meta',
    })
    return 'bloqueado'
  }

  // ---- Mídia ----
  let conteudo = incoming.content

  if (incoming.mediaUrl && incoming.messageType !== 'text') {
    /* incoming.mediaUrl guarda o ID da mídia, não uma URL: na Meta o arquivo
       sai de duas chamadas autenticadas. Baixa AGORA — o id expira e esperar a
       janela de debounce perderia o arquivo. */
    const arquivo = await downloadMetaMedia(incoming.mediaUrl)

    if (!arquivo) {
      conteudo = `${incoming.content} [não foi possível baixar o arquivo]`
    } else if (incoming.messageType === 'audio') {
      try {
        const transcricao = await transcribeAudioBuffer(arquivo.buffer, arquivo.contentType)
        if (transcricao) conteudo = `[Áudio transcrito]: ${transcricao}`
      } catch (e) {
        console.error('[Webhook/meta] transcrição falhou:', e)
        conteudo = '[Áudio recebido — falha na transcrição]'
      }
    } else if (incoming.messageType === 'image') {
      try {
        const legenda = incoming.content !== '[Imagem recebida]' ? incoming.content : undefined
        const analise = await analyzeImageBuffer(arquivo.buffer, arquivo.contentType, legenda)
        if (analise) conteudo = `[Imagem analisada]: ${analise}`
      } catch (e) {
        console.error('[Webhook/meta] análise de imagem falhou:', e)
      }

      // Foto no meio de uma coleta de documentos é documento (mesma razão do zapi).
      if (await aguardandoDocumentos(contact.id)) {
        const recebido = await guardarDocumento({
          contactId: contact.id,
          bytes: arquivo.buffer,
          contentType: arquivo.contentType,
        })
        if (recebido) {
          conteudo = `${conteudo}
[Arquivo guardado como documento do negócio — confirme o recebimento e diga qual documento é.]`
        }
      }
    } else if (incoming.messageType === 'document') {
      const recebido = await guardarDocumento({
        contactId: contact.id,
        bytes: arquivo.buffer,
        contentType: arquivo.contentType,
        nomeSugerido: incoming.content,
      })

      conteudo = recebido
        ? `[Documento recebido: ${incoming.content}] — o arquivo já foi guardado. Confirme o recebimento, diga qual documento é e o que ainda falta. NÃO avalie o conteúdo.`
        : `[Documento recebido: ${incoming.content}, mas não foi possível guardá-lo] — peça para reenviar.`
    }
  }

  await adminDb.from('messages').insert({
    conversation_id: conversation.id,
    contact_id: contact.id,
    role: 'user',
    content: conteudo,
    media_type: incoming.messageType,
    channel: 'meta',
  })

  // ---- Debounce ----
  try {
    const { isFirst, size } = await enqueueMessage({
      content: conteudo,
      contactId: contact.id,
      conversationId: conversation.id,
      channel: 'meta',
      replyAddress: incoming.phone!,
      enqueuedAt: Date.now(),
    })

    console.log(`[Webhook/meta] enfileirado contato=${contact.id} primeiro=${isFirst} fila=${size}`)

    if (isFirst) {
      after(async () => {
        try {
          await aguardarEProcessar('meta', contact.id)
        } catch (err) {
          console.error('[Webhook/meta] processamento pós-janela falhou:', err)
          await clearQueueLocks('meta', contact.id).catch(() => {})
          await avisarFalha(conversation.id, contact.id)
        }
      })
    }

    return isFirst ? 'enfileirado_primeiro' : 'enfileirado'
  } catch (err) {
    // Redis fora do ar: processa na hora em vez de engolir a mensagem.
    console.error('[Webhook/meta] debounce falhou, processando direto:', err)
    await clearQueueLocks('meta', contact.id).catch(() => {})

    after(async () => {
      try {
        await processMessage({
          channel: 'meta',
          replyAddress: incoming.phone!,
          message: conteudo,
          contact,
          conversationId: conversation.id,
        })
      } catch (e) {
        console.error('[Webhook/meta] pipeline falhou:', e)
        await avisarFalha(conversation.id, contact.id)
      }
    })

    return 'processando'
  }
}

/**
 * Registra a falha no histórico. Diferente do zapi, NÃO tenta enviar o aviso
 * pelo canal: se o pipeline quebrou por credencial ausente da Meta — que é o
 * caso mais provável enquanto o canal não foi configurado —, o envio quebraria
 * pelo mesmo motivo e só somaria ruído no log.
 */
async function avisarFalha(conversationId: string, contactId: string) {
  const { error } = await createAdminClient().from('messages').insert({
    conversation_id: conversationId,
    contact_id: contactId,
    role: 'assistant',
    content:
      'Oi! Recebi sua mensagem mas tive um probleminha técnico aqui. Pode mandar de novo, por favor?',
    media_type: 'text',
    agent: 'fallback',
    channel: 'meta',
  })
  if (error) console.error('[Webhook/meta] registro do fallback falhou:', error.message)
}
