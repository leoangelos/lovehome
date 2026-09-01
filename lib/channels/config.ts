// ==========================================
// Carregador de credenciais de canal — le de channel_configs, decifra os campos
// sensiveis e mantem em cache por 5 minutos. Cai para variavel de ambiente
// quando a linha do banco ainda nao foi preenchida (dev e bootstrap).
//
// Credenciais por canal. Nao ha credencial de gateway de curso aqui: o
// equivalente aqui e o Asaas, que entra junto com a integracao no Marco 3
// (PRD 14) — inventar a funcao antes de existir integracao so criaria codigo
// morto que alguem tomaria por pronto.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { tryDecryptSecret } from '@/lib/crypto/encrypt'
import type { IntegrationChannel } from './types'

export interface ChannelCredentials {
  channel: IntegrationChannel
  isActive: boolean
  phoneId: string | null // Meta: phone_number_id | Z-API: instance
  accessToken: string | null // Meta: Bearer | Z-API: token
  appSecret: string | null // Meta app secret
  verifyToken: string | null // Meta webhook verify token
  clientToken: string | null // Z-API client token
  forwarderSecret: string | null // Segredo pre-compartilhado do forwarder (auth alternativa)
  notificationGroupId: string | null // Grupo de WhatsApp que recebe alerta de escalacao (zapi)
  webhookUrl: string | null // So 'crm': URL do webhook de leads (nao e segredo)
}

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<IntegrationChannel, { data: ChannelCredentials; expiresAt: number }>()

/**
 * Credenciais de um canal. O banco e a fonte de verdade; o ambiente e fallback
 * so enquanto a linha nao foi preenchida pelo painel.
 */
export async function getChannelCredentials(channel: IntegrationChannel): Promise<ChannelCredentials> {
  const now = Date.now()
  const cached = cache.get(channel)
  if (cached && cached.expiresAt > now) return cached.data

  const creds = await loadFromDb(channel)
  cache.set(channel, { data: creds, expiresAt: now + CACHE_TTL_MS })
  return creds
}

/** Descarta o cache de um canal. Chamar depois que o painel salva config nova. */
export function invalidateChannelCache(channel?: IntegrationChannel) {
  if (channel) cache.delete(channel)
  else cache.clear()
}

async function loadFromDb(channel: IntegrationChannel): Promise<ChannelCredentials> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('channel_configs')
    .select('*')
    .eq('channel', channel)
    .maybeSingle()

  const base: ChannelCredentials = {
    channel,
    isActive: data?.is_active ?? false,
    phoneId: data?.phone_id ?? null,
    accessToken: tryDecryptSecret(data?.access_token_encrypted),
    appSecret: tryDecryptSecret(data?.app_secret_encrypted),
    verifyToken: tryDecryptSecret(data?.verify_token_encrypted),
    clientToken: tryDecryptSecret(data?.client_token_encrypted),
    forwarderSecret: tryDecryptSecret(data?.forwarder_secret_encrypted),
    notificationGroupId: data?.notification_group_id ?? null,
    webhookUrl: data?.webhook_url ?? null,
  }

  return applyEnvFallback(channel, base)
}

/** Completa com variavel de ambiente o que o banco nao forneceu. */
function applyEnvFallback(channel: IntegrationChannel, creds: ChannelCredentials): ChannelCredentials {
  if (channel === 'crm') {
    return {
      ...creds,
      webhookUrl: creds.webhookUrl || process.env.CRM_WEBHOOK_URL || null,
      verifyToken: creds.verifyToken || process.env.CRM_WEBHOOK_SECRET || null,
    }
  }
  if (channel === 'meta') {
    return {
      ...creds,
      phoneId: creds.phoneId || process.env.META_WHATSAPP_PHONE_ID || null,
      accessToken: creds.accessToken || process.env.META_WHATSAPP_TOKEN || null,
      appSecret: creds.appSecret || process.env.META_APP_SECRET || null,
      verifyToken: creds.verifyToken || process.env.META_WEBHOOK_VERIFY_TOKEN || null,
    }
  }
  if (channel === 'zapi') {
    return {
      ...creds,
      phoneId: creds.phoneId || process.env.ZAPI_INSTANCE || null,
      accessToken: creds.accessToken || process.env.ZAPI_TOKEN || null,
      clientToken: creds.clientToken || process.env.ZAPI_CLIENT_TOKEN || null,
      /* O Z-API nao assina o webhook. `verifyToken` aqui e o segredo que a URL
         registrada la carrega (`?token=...`) — sem ele, qualquer POST na URL
         publica viraria mensagem de cliente, resposta pelo WhatsApp da
         imobiliaria e chamada paga de modelo. */
      verifyToken: creds.verifyToken || process.env.ZAPI_WEBHOOK_SECRET || null,
    }
  }
  return creds
}
