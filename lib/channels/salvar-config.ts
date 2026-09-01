// ==========================================
// Gravação e leitura das credenciais de canal (PRD 9 e 13).
//
// Este módulo existe para que a tela de Canais, quando for construída, NÃO
// tenha como fazer a coisa errada. Toda a manipulação de segredo mora aqui:
//
//   - ESCRITA sempre cifra (AES-256-GCM, lib/crypto/encrypt.ts). Não existe
//     caminho que aceite um token e o grave como texto.
//   - LEITURA para tela nunca devolve o segredo. Devolve se ESTÁ configurado e
//     os últimos 4 caracteres, que é o suficiente para alguém reconhecer qual
//     credencial está lá sem que a tela, o HTML e o log de rede carreguem o
//     valor. Quem precisa do segredo de verdade é o servidor, por
//     `getChannelCredentials`.
//
// Consequência que vale saber: campo em branco no formulário significa
// "mantém o que já está lá", não "apaga". Uma tela que mostra segredo mascarado
// e grava o mascarado por cima destrói a credencial no primeiro salvamento de
// qualquer outro campo — e o canal cai sem ninguém entender por quê. Para
// apagar de fato existe `limparCredencial`, que é um pedido explícito.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { encryptSecret, maskSecret, tryDecryptSecret } from '@/lib/crypto/encrypt'
import { invalidateChannelCache } from './config'
import type { IntegrationChannel } from './types'

/** Campos secretos e a coluna cifrada de cada um. */
const COLUNA_SECRETA = {
  accessToken: 'access_token_encrypted',
  appSecret: 'app_secret_encrypted',
  verifyToken: 'verify_token_encrypted',
  clientToken: 'client_token_encrypted',
} as const

export type CampoSecreto = keyof typeof COLUNA_SECRETA

export interface EntradaConfig {
  isActive?: boolean
  /** Só para 'crm': URL do webhook de leads. Não é segredo, mas é validada. */
  webhookUrl?: string | null
  displayName?: string | null
  phoneId?: string | null
  businessId?: string | null
  notes?: string | null
  /** Segredos em texto — cifrados aqui, nunca guardados como vieram. */
  accessToken?: string | null
  appSecret?: string | null
  verifyToken?: string | null
  clientToken?: string | null
}

export interface SegredoNaTela {
  configurado: boolean
  mascara: string
}

export interface ConfigNaTela {
  channel: IntegrationChannel
  webhookUrl: string | null
  isActive: boolean
  displayName: string | null
  phoneId: string | null
  businessId: string | null
  notes: string | null
  atualizadoEm: string | null
  segredos: Record<CampoSecreto, SegredoNaTela>
  /** Segredo que vem de variável de ambiente e não do banco. */
  vindoDoAmbiente: CampoSecreto[]
}

const CAMPOS_SECRETOS = Object.keys(COLUNA_SECRETA) as CampoSecreto[]

/** Variável de ambiente equivalente a cada segredo, por canal. */
const ENV_EQUIVALENTE: Partial<Record<IntegrationChannel, Partial<Record<CampoSecreto, string>>>> = {
  meta: {
    accessToken: 'META_WHATSAPP_TOKEN',
    appSecret: 'META_APP_SECRET',
    verifyToken: 'META_WEBHOOK_VERIFY_TOKEN',
  },
  zapi: {
    accessToken: 'ZAPI_TOKEN',
    clientToken: 'ZAPI_CLIENT_TOKEN',
    // Segredo do webhook (o Z-API não assina; a URL registrada leva `?token=`).
    verifyToken: 'ZAPI_WEBHOOK_SECRET',
  },
  /* O Asaas não é canal de mensagem, mas guarda segredo do mesmo jeito: a chave
     da API e o token que ele devolve no header do webhook. */
  asaas: {
    accessToken: 'ASAAS_API_KEY',
    verifyToken: 'ASAAS_WEBHOOK_TOKEN',
  },
  // O segredo assina os POSTs de lead que NÓS enviamos ao CRM da casa.
  crm: {
    verifyToken: 'CRM_WEBHOOK_SECRET',
  },
}

/**
 * Salva a configuração de um canal. Campo ausente ou `undefined` é preservado;
 * `null` explícito apaga.
 */
export async function salvarConfigCanal(
  channel: IntegrationChannel,
  entrada: EntradaConfig,
  atualizadoPor?: string
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const supabase = createAdminClient()

  const patch: Record<string, unknown> = {
    channel,
    updated_at: new Date().toISOString(),
  }
  if (atualizadoPor) patch.updated_by = atualizadoPor

  if (entrada.isActive !== undefined) patch.is_active = entrada.isActive
  if (entrada.displayName !== undefined) patch.display_name = entrada.displayName
  if (entrada.phoneId !== undefined) patch.phone_id = entrada.phoneId
  if (entrada.businessId !== undefined) patch.business_id = entrada.businessId
  if (entrada.notes !== undefined) patch.notes = entrada.notes
  if (entrada.webhookUrl !== undefined) {
    const url = (entrada.webhookUrl ?? '').trim()
    /* URL torta gravada aqui só falharia no primeiro lead real, horas depois.
       http:// fica permitido para teste local; produção usa https. */
    if (url && !/^https?:\/\/.+/i.test(url)) {
      return { ok: false, erro: 'A URL do webhook precisa começar com http:// ou https://.' }
    }
    patch.webhook_url = url || null
  }

  for (const campo of CAMPOS_SECRETOS) {
    const valor = entrada[campo]
    if (valor === undefined) continue // não mexeu no campo

    const coluna = COLUNA_SECRETA[campo]

    if (valor === null || valor.trim() === '') {
      /* String vazia é tratada como "não mexeu", não como "apaga". Formulário
         HTML manda '' para todo campo não preenchido, e interpretar isso como
         apagar destruiria a credencial ao salvar qualquer outro campo. */
      if (valor === null) patch[coluna] = null
      continue
    }

    /* O único ponto do sistema onde credencial de canal é escrita. Se algum dia
       aparecer um segundo, é bug. */
    patch[coluna] = encryptSecret(valor.trim())
  }

  const { error } = await supabase
    .from('channel_configs')
    .upsert(patch, { onConflict: 'channel' })

  if (error) {
    console.error('[canais] gravação falhou:', error.message)
    return { ok: false, erro: 'Não foi possível salvar a configuração.' }
  }

  // O carregador guarda credencial por 5 minutos; sem isto o canal continuaria
  // usando a credencial velha até o cache vencer.
  invalidateChannelCache(channel)

  /* Log sem valor nenhum: registra QUAIS campos mudaram, nunca o conteúdo. */
  const mexidos = CAMPOS_SECRETOS.filter((c) => entrada[c] !== undefined)
  console.log(
    `[canais] ${channel} atualizado${mexidos.length ? ` — segredos alterados: ${mexidos.join(', ')}` : ''}`
  )

  return { ok: true }
}

/** Apaga uma credencial de propósito. Separado do salvar para não acontecer por engano. */
export async function limparCredencial(
  channel: IntegrationChannel,
  campo: CampoSecreto
): Promise<{ ok: boolean }> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('channel_configs')
    .update({ [COLUNA_SECRETA[campo]]: null, updated_at: new Date().toISOString() })
    .eq('channel', channel)

  invalidateChannelCache(channel)
  if (error) console.error('[canais] limpeza falhou:', error.message)
  return { ok: !error }
}

/**
 * Configuração para exibir na tela. NUNCA devolve segredo — só se está
 * preenchido e os últimos 4 caracteres.
 */
export async function lerConfigParaTela(channel: IntegrationChannel): Promise<ConfigNaTela> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('channel_configs')
    .select('*')
    .eq('channel', channel)
    .maybeSingle()

  const segredos = {} as Record<CampoSecreto, SegredoNaTela>
  const vindoDoAmbiente: CampoSecreto[] = []

  for (const campo of CAMPOS_SECRETOS) {
    const cifrado = data?.[COLUNA_SECRETA[campo]] as string | null | undefined
    const claro = tryDecryptSecret(cifrado)

    if (claro) {
      segredos[campo] = { configurado: true, mascara: maskSecret(claro) }
      continue
    }

    /* Sem valor no banco, o canal ainda pode estar funcionando por variável de
       ambiente (é o fallback de `getChannelCredentials`). Mostrar "não
       configurado" nesse caso faria alguém preencher achando que está
       resolvendo um problema que não existe — ou, pior, desconfiar do canal que
       está no ar. */
    const env = ENV_EQUIVALENTE[channel]?.[campo]
    const doAmbiente = env ? process.env[env] : undefined
    if (doAmbiente) {
      vindoDoAmbiente.push(campo)
      segredos[campo] = { configurado: true, mascara: maskSecret(doAmbiente) }
    } else {
      segredos[campo] = { configurado: false, mascara: '' }
    }
  }

  return {
    channel,
    isActive: data?.is_active ?? false,
    displayName: data?.display_name ?? null,
    phoneId: data?.phone_id ?? null,
    businessId: data?.business_id ?? null,
    notes: data?.notes ?? null,
    webhookUrl: data?.webhook_url ?? null,
    atualizadoEm: data?.updated_at ?? null,
    segredos,
    vindoDoAmbiente,
  }
}
