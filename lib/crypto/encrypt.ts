// ==========================================
// Criptografia at-rest — AES-256-GCM + HMAC-SHA256.
// AES-256-GCM para segredos reversiveis, mais
// hmacDeterministic(), que e novo aqui e existe por causa do CPF (PRD 6.2).
//
// A chave mestra vive em APP_ENCRYPTION_KEY. Credenciais de canal, tokens de
// terceiros e o CPF ficam cifrados no banco e so viram texto claro aqui.
// ==========================================

import crypto from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32

function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('APP_ENCRYPTION_KEY is not set')
  }
  // Aceita base64 (44 chars) ou hex (64 chars). Cai para SHA-256 do texto bruto
  // para que uma chave em formato de passphrase tambem funcione.
  let key: Buffer
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex')
  } else {
    try {
      const decoded = Buffer.from(raw, 'base64')
      key = decoded.length === KEY_BYTES ? decoded : crypto.createHash('sha256').update(raw).digest()
    } catch {
      key = crypto.createHash('sha256').update(raw).digest()
    }
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(`APP_ENCRYPTION_KEY must resolve to ${KEY_BYTES} bytes`)
  }
  return key
}

/**
 * Cifra e devolve uma string autocontida:
 * `v1:<iv_base64>:<authTag_base64>:<ciphertext_base64>`
 */
export function encryptSecret(plaintext: string): string {
  if (plaintext === '' || plaintext == null) return ''
  const key = getKey()
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':')
}

/** Decifra o que encryptSecret produziu. Lanca se o texto cifrado foi adulterado. */
export function decryptSecret(blob: string): string {
  if (!blob) return ''
  const parts = blob.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted blob format')
  }
  const [, ivB64, tagB64, ctB64] = parts
  const key = getKey()
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const ct = Buffer.from(ctB64, 'base64')
  const decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
}

/** Tenta decifrar — devolve null em qualquer falha, em vez de lancar. */
export function tryDecryptSecret(blob: string | null | undefined): string | null {
  if (!blob) return null
  try {
    return decryptSecret(blob)
  } catch {
    return null
  }
}

/** Mascara um segredo para exibicao no painel: "••••••••last4". */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return ''
  if (value.length <= 4) return '••••'
  return '••••••••' + value.slice(-4)
}

/**
 * HMAC-SHA256 com a chave mestra — deterministico, logo indexavel.
 *
 * Existe porque AES-GCM usa IV aleatorio (que e a
 * pratica correta) e, por isso, o mesmo CPF cifrado duas vezes gera textos
 * diferentes — nao da para perguntar "esse CPF ja existe?" por igualdade. O HMAC
 * resolve a busca sem guardar o numero em claro e sem recorrer a criptografia
 * deterministica, que enfraqueceria o sigilo so para permitir o indice.
 */
export function hmacDeterministic(value: string): string {
  return crypto.createHmac('sha256', getKey()).update(value).digest('hex')
}

/** Comparacao em tempo constante — para validar secrets de webhook. */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}
