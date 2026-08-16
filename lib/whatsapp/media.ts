// ==========================================
// Media Processing — audio transcription & image analysis
// ==========================================

import { openai } from '@/lib/openai/client'
import { registrarUso } from '@/lib/observabilidade/uso'

/**
 * Transcribe audio from a URL using OpenAI Whisper.
 * Downloads the audio file and sends to the Whisper API.
 */
export async function transcribeAudio(audioUrl: string): Promise<string> {
  console.log('[Media] Transcribing audio from:', audioUrl)
  const start = Date.now()

  // Download audio from Z-API URL
  const response = await fetch(audioUrl)
  if (!response.ok) {
    throw new Error(`Failed to download audio: ${response.status} ${response.statusText}`)
  }

  const audioBuffer = await response.arrayBuffer()
  const audioBlob = new Blob([audioBuffer], { type: 'audio/ogg' })

  // Create a File object for the OpenAI API
  const audioFile = new File([audioBlob], 'audio.ogg', { type: 'audio/ogg' })

  /* `verbose_json` só para vir a duração do áudio: o Whisper cobra por minuto,
     não por token, e sem isso o custo da transcrição ficaria fora da conta. O
     texto continua em `.text`. */
  const transcription = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: audioFile,
    language: 'pt',
    response_format: 'verbose_json',
  })

  const text = transcription.text?.trim() || ''
  const duracao = Date.now() - start

  await registrarUso({
    operacao: 'transcricao',
    modelo: 'whisper-1',
    segundosAudio: (transcription as { duration?: number }).duration,
    duracaoMs: duracao,
    canal: 'zapi',
    detalhe: {
      resumo: 'Transcreveu um áudio recebido',
      entradas: [
        {
          rotulo: 'Duração do áudio',
          valor: `${(transcription as { duration?: number }).duration ?? '?'} segundos`,
        },
        { rotulo: 'Texto transcrito', valor: `${text.length} caracteres` },
      ],
    },
  })

  /* Só o tamanho: o que o cliente falou é dado pessoal, e o log da Vercel fica
     visível para quem tem acesso ao projeto. Um CPF ditado por áudio pararia ali. */
  console.log(`[Media] Audio transcribed in ${duracao}ms (${text.length} chars)`)

  return text
}

/**
 * Transcribe audio from raw bytes (used when the source URL is not publicly
 * fetchable, e.g. Meta media that requires an auth header to download).
 */
export async function transcribeAudioBuffer(
  buffer: Buffer,
  contentType = 'audio/ogg'
): Promise<string> {
  const start = Date.now()
  const ext = contentType.includes('mpeg') ? 'mp3' : contentType.includes('wav') ? 'wav' : 'ogg'
  const audioFile = new File([new Uint8Array(buffer)], `audio.${ext}`, { type: contentType })

  const transcription = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: audioFile,
    language: 'pt',
    response_format: 'verbose_json',
  })

  const text = transcription.text?.trim() || ''
  const duracao = Date.now() - start

  await registrarUso({
    operacao: 'transcricao',
    modelo: 'whisper-1',
    segundosAudio: (transcription as { duration?: number }).duration,
    duracaoMs: duracao,
    canal: 'meta',
    detalhe: {
      resumo: 'Transcreveu um áudio recebido',
      entradas: [
        {
          rotulo: 'Duração do áudio',
          valor: `${(transcription as { duration?: number }).duration ?? '?'} segundos`,
        },
        { rotulo: 'Texto transcrito', valor: `${text.length} caracteres` },
      ],
    },
  })

  console.log(`[Media] Audio (buffer) transcribed in ${duracao}ms (${text.length} chars)`)
  return text
}

/**
 * Analyze an image from raw bytes by encoding it as a base64 data URL.
 * Use this for Meta media, whose download URL is not publicly accessible.
 */
export async function analyzeImageBuffer(
  buffer: Buffer,
  contentType: string,
  caption?: string
): Promise<string> {
  const dataUrl = `data:${contentType || 'image/jpeg'};base64,${buffer.toString('base64')}`
  return analyzeImage(dataUrl, caption)
}

/**
 * Analyze an image using GPT-4o vision.
 * Accepts a public image URL or a base64 data URL.
 */
export async function analyzeImage(
  imageUrl: string,
  caption?: string
): Promise<string> {
  console.log('[Media] Analyzing image:', imageUrl.startsWith('data:') ? '(data url)' : imageUrl)
  const start = Date.now()

  const promptText = caption
    ? `A pessoa enviou esta imagem com a legenda: "${caption}"`
    : 'A pessoa enviou esta imagem pelo WhatsApp. Descreva o conteúdo de forma detalhada.'

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        /* Prompt escrito para ESTE contexto: a imagem que chega é foto de
           imóvel, RG ou comprovante — não conversa pessoal. */
        content: `Você analisa imagens recebidas por WhatsApp numa imobiliária. Sua análise não vai para o cliente: ela vira contexto para o agente que vai responder.

Se for FOTO DE IMÓVEL:
- Descreva cômodo, estado de conservação, acabamento e o que dá para inferir de tamanho e luz
- Aponte reforma aparente, infiltração, mofo ou dano visível — sem suavizar
- Se der para ver, diga se parece foto de anúncio ou foto tirada na hora

Se for DOCUMENTO (RG, CNH, comprovante de renda ou de residência, contrato):
- Diga apenas QUE TIPO de documento é e se está legível por inteiro
- NÃO transcreva CPF, RG, número de conta, salário nem endereço completo. Esses dados são conferidos por uma pessoa na tela de documentos, com o arquivo original — repeti-los aqui os espalharia pelo histórico da conversa

Se for PRINT DE TELA (anúncio de outro site, conversa, simulação de financiamento):
- Transcreva o que está escrito, mantendo valores e condições exatos

Qualquer outra imagem: descreva em uma ou duas frases.

Seja direto e curto. Se a imagem estiver ilegível ou escura demais, diga isso em vez de adivinhar.`,
      },
      {
        role: 'user',
        content: [
          { type: 'text' as const, text: promptText },
          { type: 'image_url' as const, image_url: { url: imageUrl, detail: 'high' as const } },
        ],
      },
    ],
    max_tokens: 1000,
  })

  const analysis = response.choices[0].message.content?.trim() || ''
  const duracao = Date.now() - start

  await registrarUso({
    operacao: 'visao',
    modelo: 'gpt-4o',
    tokensEntrada: response.usage?.prompt_tokens,
    tokensSaida: response.usage?.completion_tokens,
    duracaoMs: duracao,
    detalhe: {
      resumo: 'Analisou uma imagem recebida',
      entradas: [{ rotulo: 'Análise devolvida', valor: `${analysis.length} caracteres` }],
    },
  })

  console.log(`[Media] Image analyzed in ${duracao}ms (${analysis.length} chars)`)

  return analysis
}
