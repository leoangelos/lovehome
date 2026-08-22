// ==========================================
// Webhook Z-API — camada fina sobre o pipeline unificado.
//
// Diferenca principal: o agendamento da janela de debounce nao usa QStash. O
// webhook responde 200 imediatamente e o `after()` do Next segura a espera
// depois da resposta — o Z-API nao fica pendurado e nao reenvia por timeout.
// ==========================================

import { NextResponse, after } from 'next/server'
import crypto from 'crypto'
import { getChannelCredentials } from '@/lib/channels/config'
import { sendFractioned } from '@/lib/whatsapp/sender'
import { transcribeAudio, analyzeImage } from '@/lib/whatsapp/media'
import { redis } from '@/lib/redis/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseZApiIncoming } from '@/lib/channels/zapi'
import { resolveContact, resolveConversation } from '@/lib/channels/identity'
import { isContactBlocked } from '@/lib/channels/blocklist'
import { processMessage } from '@/lib/pipeline/process-message'
import { enqueueMessage, clearQueueLocks } from '@/lib/debounce/queue'
import { aguardarEProcessar } from '@/lib/debounce/runner'
import { receberDocumento, aguardandoDocumentos } from '@/lib/documentos/receber'
import { negocioAguardandoAssinatura, receberViaAssinada } from '@/lib/leasing/via-assinada'
import { extractPhoneKey } from '@/lib/utils/phone'
import type { ZApiWebhookPayload } from '@/lib/types/whatsapp'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

function comparaSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

/* O Z-API NÃO assina o webhook — diferente da Meta (HMAC) e do Asaas (token no
   header). Sem esta trava, a URL pública aceitava qualquer POST: bastava
   forjar uma mensagem "vinda" de um telefone qualquer para o bot responder
   pelo WhatsApp da imobiliária àquele número, gastar OpenAI e ainda mandar o
   servidor baixar URLs arbitrárias de "áudio" e "imagem".

   O segredo viaja na URL registrada no Z-API (`?token=...`) ou no header
   `x-webhook-token`. Fail-closed: sem segredo configurado, 403 — a mesma
   postura da Meta e do Asaas. */
async function autenticar(req: Request): Promise<NextResponse | null> {
  const creds = await getChannelCredentials('zapi')
  const esperado = creds.verifyToken

  if (!esperado) {
    console.error(
      '[Webhook/zapi] recusado: segredo do webhook não configurado (ZAPI_WEBHOOK_SECRET ou tela de Canais)'
    )
    return NextResponse.json({ error: 'Integração não configurada' }, { status: 403 })
  }

  const url = new URL(req.url)
  const recebido = url.searchParams.get('token') ?? req.headers.get('x-webhook-token') ?? ''

  if (!recebido || !comparaSeguro(recebido, esperado)) {
    console.error('[Webhook/zapi] token inválido')
    return NextResponse.json({ error: 'Token inválido' }, { status: 401 })
  }

  return null
}

export async function POST(req: Request) {
  /* Antes de ler o corpo, gravar em webhook_logs ou tocar no Redis: requisição
     não autenticada não pode nem encher a tabela de log. */
  const recusa = await autenticar(req)
  if (recusa) return recusa

  try {
    const rawBody = await req.text()
    let payload: ZApiWebhookPayload
    try {
      payload = JSON.parse(rawBody)
    } catch {
      console.error('[Webhook/zapi] JSON inválido:', rawBody.substring(0, 500))
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }

    const callbackType = (payload as unknown as Record<string, unknown>).type as string | undefined
    if (callbackType && callbackType !== 'ReceivedCallback') {
      return NextResponse.json({ status: 'ignorado', type: callbackType })
    }

    // Mensagem própria, grupo e newsletter não são atendimento.
    if (payload.fromMe || payload.isGroup || payload.isNewsletter) {
      return NextResponse.json({ status: 'ignorado' })
    }

    const adminDb = createAdminClient()

    /* Await, não fire-and-forget: no Vercel o runtime congela quando a resposta
       sai, e o insert nunca terminaria. */
    const { error: logErr } = await adminDb.from('webhook_logs').insert({
      payload,
      phone: payload.phone || null,
      event_type: callbackType || payload.status || 'desconhecido',
    })
    if (logErr) console.log('[Webhook/zapi] log ignorado:', logErr.message)

    const incoming = parseZApiIncoming(payload)
    if (!incoming) return NextResponse.json({ status: 'ignorado' })

    // Dedup por messageId — o Z-API reentrega em caso de timeout.
    const isDuplicate = await redis.set(`dedup:${incoming.messageId}`, '1', { ex: 300, nx: true })
    if (isDuplicate !== 'OK') return NextResponse.json({ status: 'duplicado' })

    /* Resolve o contato ANTES de qualquer processamento de mídia: contato
       bloqueado não pode chegar em transcrição nem em Vision, que são chamadas
       cobradas por token. */
    const contact = await resolveContact({
      channel: 'zapi',
      externalId: incoming.externalId,
      phone: incoming.phone,
      phoneKey: incoming.phone ? extractPhoneKey(incoming.phone) : undefined,
      name: incoming.senderName,
    })

    const conversation = await resolveConversation(contact.id, 'zapi')

    if (isContactBlocked(contact)) {
      console.log('[Webhook/zapi] Contato bloqueado — grava cru, sem IA:', contact.id)
      await adminDb.from('messages').insert({
        conversation_id: conversation.id,
        contact_id: contact.id,
        role: 'user',
        content: incoming.content,
        media_type: incoming.messageType,
        media_url: incoming.mediaUrl,
        channel: 'zapi',
      })
      return NextResponse.json({ status: 'bloqueado' })
    }

    // ---- Mídia ----
    let conteudo = incoming.content
    if (incoming.messageType === 'audio' && incoming.mediaUrl) {
      try {
        const transcricao = await transcribeAudio(incoming.mediaUrl)
        if (transcricao) conteudo = `[Áudio transcrito]: ${transcricao}`
      } catch (e) {
        console.error('[Webhook/zapi] transcrição falhou:', e)
        conteudo = '[Áudio recebido — falha na transcrição]'
      }
    } else if (incoming.messageType === 'image' && incoming.mediaUrl) {
      try {
        const legenda = incoming.content !== '[Imagem recebida]' ? incoming.content : undefined
        const analise = await analyzeImage(incoming.mediaUrl, legenda)
        if (analise) conteudo = `[Imagem analisada]: ${analise}`
      } catch (e) {
        console.error('[Webhook/zapi] análise de imagem falhou:', e)
      }

      /* Foto enviada no meio de uma coleta de documentos é documento: no Brasil
         RG e comprovante chegam fotografados muito mais do que como PDF. Guarda
         o arquivo ALÉM de analisar — a análise vira contexto para o agente, o
         arquivo vira a via que a equipe confere. */
      if (await aguardandoDocumentos(contact.id)) {
        const recebido = await receberDocumento({
          contactId: contact.id,
          mediaUrl: incoming.mediaUrl,
        })
        if (recebido) {
          conteudo = `${conteudo}
[Arquivo guardado como documento do negócio — confirme o recebimento e diga qual documento é.]`
        }
      }
    } else if (incoming.messageType === 'document' && incoming.mediaUrl) {
      /* Baixa AGORA: a URL do Z-API expira, e esperar a janela de debounce
         significaria perder o arquivo que a pessoa acabou de mandar. */

      /* Contrato gerado esperando a via assinada? Então o PDF que chegou é,
         com toda probabilidade, o contrato de volta — vai para o negócio como
         candidato, não para a fila de documentos. Quem confirma é uma pessoa,
         no cartão. Se não for PDF, cai no caminho normal. */
      const aguardandoAssinatura = await negocioAguardandoAssinatura(contact.id)
      const viaAssinada = aguardandoAssinatura
        ? await receberViaAssinada({ dealId: aguardandoAssinatura.id, mediaUrl: incoming.mediaUrl })
        : null

      if (viaAssinada?.ok) {
        conteudo = `[Contrato assinado recebido: ${incoming.content}] — o arquivo foi guardado como via assinada do contrato${aguardandoAssinatura?.reference_code ? ` do ${aguardandoAssinatura.reference_code}` : ''} e a equipe vai conferir a assinatura. Confirme o recebimento em uma frase e diga que a equipe confere e retorna. NÃO peça documentos.`
      } else {
        const recebido = await receberDocumento({
          contactId: contact.id,
          mediaUrl: incoming.mediaUrl,
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
      media_url: incoming.mediaUrl,
      channel: 'zapi',
    })

    // ---- Debounce ----
    try {
      const { isFirst, size } = await enqueueMessage({
        content: conteudo,
        contactId: contact.id,
        conversationId: conversation.id,
        channel: 'zapi',
        replyAddress: incoming.phone!,
        enqueuedAt: Date.now(),
      })

      console.log(`[Webhook/zapi] enfileirado contato=${contact.id} primeiro=${isFirst} fila=${size}`)

      /* Só quem abriu a janela espera. As demais mensagens da rajada apenas
         entram na fila e retornam — quem processa é o líder. */
      if (isFirst) {
        after(async () => {
          try {
            await aguardarEProcessar('zapi', contact.id)
          } catch (err) {
            console.error('[Webhook/zapi] processamento pós-janela falhou:', err)
            await clearQueueLocks('zapi', contact.id).catch(() => {})
            await avisarFalha(conversation.id, contact.id, incoming.phone!)
          }
        })
      }

      return NextResponse.json({ status: 'enfileirado', primeiro: isFirst })
    } catch (err) {
      // Redis fora do ar: processa na hora em vez de engolir a mensagem.
      console.error('[Webhook/zapi] debounce falhou, processando direto:', err)
      await clearQueueLocks('zapi', contact.id).catch(() => {})

      after(async () => {
        try {
          await processMessage({
            channel: 'zapi',
            replyAddress: incoming.phone!,
            message: conteudo,
            contact,
            conversationId: conversation.id,
          })
        } catch (e) {
          console.error('[Webhook/zapi] pipeline falhou:', e)
          await avisarFalha(conversation.id, contact.id, incoming.phone!)
        }
      })

      return NextResponse.json({ status: 'processando' })
    }
  } catch (error) {
    console.error('[Webhook/zapi] erro:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

/**
 * Silêncio é a pior resposta possível: a pessoa fica esperando sem saber que
 * algo quebrou. Avisa e registra no histórico para o corretor ver o que houve.
 */
async function avisarFalha(conversationId: string, contactId: string, phone: string) {
  const texto =
    'Oi! Recebi sua mensagem mas tive um probleminha técnico aqui. Pode mandar de novo, por favor?'

  /* Registra ANTES de enviar. Se a ordem fosse a inversa e o
     envio falhasse — canal fora do ar, credencial errada —, o histórico ficaria
     sem nenhum registro de que houve falha, que é justamente quando alguém
     precisa saber o que aconteceu. */
  const { error } = await createAdminClient().from('messages').insert({
    conversation_id: conversationId,
    contact_id: contactId,
    role: 'assistant',
    content: texto,
    media_type: 'text',
    agent: 'fallback',
    channel: 'zapi',
  })
  if (error) console.error('[Webhook/zapi] registro do fallback falhou:', error.message)

  try {
    await sendFractioned(phone, texto)
  } catch (e) {
    console.error('[Webhook/zapi] envio do fallback falhou:', e)
  }
}
