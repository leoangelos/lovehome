// ==========================================
// WhatsApp Sender — sends via Z-API
// ==========================================

const MAX_PARTS = 6
const SEND_DELAY_MS = 3000 // 3s between parts

/* ==========================================================================
   Trava de destinatário para desenvolvimento.

   Com credenciais reais no .env, qualquer teste que exercite o pipeline manda
   mensagem DE VERDADE — e os telefones dos scripts e do seed são fictícios só
   para nós: '5511977001234' é um número perfeitamente discável, que pode ser
   de alguém. Não existe desfazer de mensagem enviada.

   Com WHATSAPP_ALLOWLIST preenchida, só os números listados recebem; o resto é
   recusado e registrado. Vazia (produção), tudo passa.

   Falha FECHADA de propósito: esquecer de limpar a variável em produção faz o
   envio parar com log explícito, o que se descobre em minutos. O inverso —
   esquecer de preenchê-la em desenvolvimento — manda mensagem para estranhos,
   e isso não se descobre nem se conserta.

   A comparação usa os últimos 8 dígitos, mesma chave de `contacts.phone_key`:
   555511999999999, +55 11 99999-9999 e 5511999999999 são o mesmo telefone, e
   uma trava que erra por formatação não serve como trava.
   ========================================================================== */
function chaveTelefone(valor: string): string {
  return valor.replace(/\D/g, '').slice(-8)
}

function destinatarioPermitido(phone: string): boolean {
  const lista = (process.env.WHATSAPP_ALLOWLIST ?? '')
    .split(',')
    .map((n) => chaveTelefone(n))
    .filter(Boolean)

  if (!lista.length) return true
  return lista.includes(chaveTelefone(phone))
}

/**
 * Send a single text message via Z-API
 */
export async function sendMessage(phone: string, text: string): Promise<void> {
  const instanceId = process.env.ZAPI_INSTANCE
  const token = process.env.ZAPI_TOKEN
  const clientToken = process.env.ZAPI_CLIENT_TOKEN

  if (!instanceId || !token || !clientToken) {
    console.error('[WhatsApp sender] Missing Z-API credentials')
    throw new Error('Z-API credentials not configured')
  }

  if (!destinatarioPermitido(phone)) {
    console.warn(
      `[WhatsApp sender] envio BLOQUEADO para ${phone} — fora de WHATSAPP_ALLOWLIST. ` +
        'Limpe a variavel para liberar todos os destinatarios.'
    )
    throw new Error(`Destinatario ${phone} fora da allowlist de desenvolvimento`)
  }

  const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Token': clientToken,
    },
    body: JSON.stringify({
      phone,
      message: text,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('[WhatsApp sender] Z-API error:', response.status, errorBody)
    throw new Error(`Z-API send failed: ${response.status}`)
  }
}

/**
 * Send a message in fractionated parts (split by paragraphs)
 * with a delay between each part for a natural reading experience
 */
export async function sendFractioned(phone: string, fullText: string): Promise<void> {
  // Split by double newlines (paragraphs)
  const parts = fullText
    .split('\n\n')
    .map(p => p.trim())
    .filter(p => p.length > 0)

  // Limit to MAX_PARTS
  const toSend = parts.length > MAX_PARTS 
    ? mergeParts(parts, MAX_PARTS)
    : parts

  for (let i = 0; i < toSend.length; i++) {
    await sendMessage(phone, toSend[i])
    
    // Wait between parts (except after the last one)
    if (i < toSend.length - 1) {
      await sleep(SEND_DELAY_MS)
    }
  }
}

/**
 * Merge parts to fit within maxParts limit
 */
function mergeParts(parts: string[], maxParts: number): string[] {
  if (parts.length <= maxParts) return parts

  const merged: string[] = []
  const partsPerGroup = Math.ceil(parts.length / maxParts)

  for (let i = 0; i < parts.length; i += partsPerGroup) {
    const group = parts.slice(i, i + partsPerGroup)
    merged.push(group.join('\n\n'))
  }

  return merged.slice(0, maxParts)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
