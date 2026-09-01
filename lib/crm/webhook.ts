// ==========================================
// Webhook de leads para o CRM da imobiliária.
//
// Dois eventos, nos momentos combinados com o produto:
//   * lead_novo              — a pessoa iniciou conversa (nome/telefone se houver)
//   * lead_cadastro_completo — formulário preenchido ou vinculado (dados atuais)
//
// Regras que não devem ser desfeitas:
//   * O PAYLOAD NUNCA LEVA CPF — nem em claro, nem hash, nem últimos dígitos.
//     A URL é infraestrutura de terceiro fora do nosso controle; mandar CPF
//     para lá multiplicaria o perímetro da LGPD por cada CRM plugado.
//   * Todo envio é assinado: X-Lovehome-Assinatura = sha256=HMAC(corpo, segredo).
//     Sem segredo configurado, NADA é enviado (fail-closed, como os webhooks
//     de entrada) — payload sem assinatura seria impossível de autenticar lá.
//   * Falha no CRM nunca derruba o atendimento: timeout curto, erro engolido
//     e logado. O lead continua no painel de qualquer jeito.
// ==========================================

import { createHmac } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getChannelCredentials } from '@/lib/channels/config'

export type EventoCrm = 'lead_novo' | 'lead_cadastro_completo' | 'teste'

export interface LeadDoEvento {
  contact_id: string
  nome: string | null
  telefone: string | null
  canal: string | null
  funil: string | null
  intencao: string | null
  cadastro: {
    registration_id: string
    nome: string | null
    email: string | null
    papeis: string[]
  } | null
}

export interface PayloadCrm {
  evento: EventoCrm
  ocorrido_em: string
  origem: 'lovehome'
  lead: LeadDoEvento | null
}

/** Corpo do POST — puro, para o check provar a forma (e a ausência de CPF). */
export function montarEventoLead(evento: EventoCrm, lead: LeadDoEvento | null, ocorridoEm: Date): PayloadCrm {
  return { evento, ocorrido_em: ocorridoEm.toISOString(), origem: 'lovehome', lead }
}

/** Assinatura do corpo cru — o CRM confere com o mesmo segredo. */
export function assinarCorpo(corpo: string, segredo: string): string {
  return `sha256=${createHmac('sha256', segredo).update(corpo, 'utf8').digest('hex')}`
}

const TIMEOUT_MS = 5_000

export interface ResultadoEnvio {
  enviado: boolean
  motivo?: string
  httpStatus?: number
}

/** Linha da tela "últimos envios" — sem o payload inteiro, que não cabe na lista. */
export interface EnvioCrmLinha {
  id: string
  evento: EventoCrm
  sucesso: boolean
  http_status: number | null
  erro: string | null
  tentativas: number
  criado_em: string
  ultima_tentativa_em: string
  lead_nome: string | null
}

/* Registrar nunca derruba o envio — mesma regra do registrarUso: uma falha de
   contabilidade não vale um lead perdido. Tudo aqui engole erro e loga. */
async function registrarEnvio(params: {
  evento: EventoCrm
  contactId: string | null
  url: string
  payload: PayloadCrm
  resultado: ResultadoEnvio
}): Promise<void> {
  try {
    const { error } = await createAdminClient().from('crm_webhook_deliveries').insert({
      evento: params.evento,
      contact_id: params.contactId,
      url: params.url,
      payload: params.payload,
      sucesso: params.resultado.enviado,
      http_status: params.resultado.httpStatus ?? null,
      erro: params.resultado.enviado ? null : (params.resultado.motivo ?? null),
    })
    if (error) console.warn('[crm] não registrou o envio:', error.message)
  } catch (e) {
    console.warn('[crm] não registrou o envio:', (e as Error).message)
  }
}

/** O POST em si: assina o corpo e respeita o timeout. Nunca lança. */
async function postAssinado(url: string, segredo: string, payload: PayloadCrm): Promise<ResultadoEnvio> {
  const corpo = JSON.stringify(payload)
  const controle = new AbortController()
  const timer = setTimeout(() => controle.abort(), TIMEOUT_MS)

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Lovehome-Evento': payload.evento,
        'X-Lovehome-Assinatura': assinarCorpo(corpo, segredo),
      },
      body: corpo,
      signal: controle.signal,
    })
    if (!r.ok) {
      console.warn(`[crm] webhook respondeu ${r.status} para ${payload.evento}`)
      return { enviado: false, motivo: `CRM respondeu HTTP ${r.status}`, httpStatus: r.status }
    }
    return { enviado: true, httpStatus: r.status }
  } catch (e) {
    console.warn(`[crm] envio de ${payload.evento} falhou:`, (e as Error).message)
    return { enviado: false, motivo: 'não foi possível alcançar a URL' }
  } finally {
    clearTimeout(timer)
  }
}

/** POST assinado na URL cadastrada, com registro do resultado. Nunca lança. */
export async function enviarParaCrm(
  payload: PayloadCrm,
  opts?: { contactId?: string | null }
): Promise<ResultadoEnvio> {
  try {
    const creds = await getChannelCredentials('crm')
    /* O teste da tela roda antes de a pessoa ativar — "configuro, testo, ativo". */
    if (!creds.isActive && payload.evento !== 'teste') {
      return { enviado: false, motivo: 'integração desativada' }
    }
    if (!creds.webhookUrl) return { enviado: false, motivo: 'URL não cadastrada' }
    /* Sem segredo não sai nada: o CRM não teria como distinguir um POST nosso
       de um forjado — mesma postura fail-closed dos webhooks de entrada. */
    if (!creds.verifyToken) return { enviado: false, motivo: 'segredo de assinatura não cadastrado' }

    const resultado = await postAssinado(creds.webhookUrl, creds.verifyToken, payload)
    /* Só tentativa REAL vira linha: configuração incompleta não é envio. */
    await registrarEnvio({
      evento: payload.evento,
      contactId: opts?.contactId ?? null,
      url: creds.webhookUrl,
      payload,
      resultado,
    })
    return resultado
  } catch (e) {
    console.warn(`[crm] envio de ${payload.evento} falhou:`, (e as Error).message)
    return { enviado: false, motivo: 'não foi possível alcançar a URL' }
  }
}

/** Últimos envios, para a tela de Canais. */
export async function listarEnviosCrm(limite = 20): Promise<EnvioCrmLinha[]> {
  const { data, error } = await createAdminClient()
    .from('crm_webhook_deliveries')
    .select('id, evento, sucesso, http_status, erro, tentativas, criado_em, ultima_tentativa_em, payload')
    .order('criado_em', { ascending: false })
    .limit(limite)

  /* Tabela ainda sem a migration 040: a tela mostra vazio em vez de quebrar. */
  if (error) {
    console.warn('[crm] não listou envios:', error.message)
    return []
  }
  return (data ?? []).map((d) => ({
    id: d.id,
    evento: d.evento as EventoCrm,
    sucesso: d.sucesso,
    http_status: d.http_status,
    erro: d.erro,
    tentativas: d.tentativas,
    criado_em: d.criado_em,
    ultima_tentativa_em: d.ultima_tentativa_em,
    lead_nome: ((d.payload as PayloadCrm | null)?.lead?.nome ?? null),
  }))
}

/**
 * Reenvia um envio que falhou: o MESMO payload guardado, assinado com o
 * segredo atual, para a URL atual — o reparo típico é "a URL estava errada,
 * corrigi, reenvia". Atualiza a própria linha (tentativas, status) em vez de
 * criar outra: a pergunta da tela é "este evento chegou?", não "quantos POSTs
 * já fiz".
 */
export async function reenviarEnvioCrm(deliveryId: string): Promise<ResultadoEnvio & { erro?: string; status?: number }> {
  const supabase = createAdminClient()

  const { data: envio } = await supabase
    .from('crm_webhook_deliveries')
    .select('id, payload, sucesso, tentativas')
    .eq('id', deliveryId)
    .maybeSingle()
  if (!envio) return { enviado: false, erro: 'Envio não encontrado.', status: 404 }

  const creds = await getChannelCredentials('crm')
  if (!creds.webhookUrl || !creds.verifyToken) {
    return { enviado: false, erro: 'Configure URL e segredo antes de reenviar.', status: 409 }
  }

  const resultado = await postAssinado(creds.webhookUrl, creds.verifyToken, envio.payload as PayloadCrm)

  await supabase
    .from('crm_webhook_deliveries')
    .update({
      sucesso: resultado.enviado,
      http_status: resultado.httpStatus ?? null,
      erro: resultado.enviado ? null : (resultado.motivo ?? null),
      tentativas: (envio.tentativas ?? 1) + 1,
      url: creds.webhookUrl,
      ultima_tentativa_em: new Date().toISOString(),
    })
    .eq('id', deliveryId)

  return resultado
}

/**
 * Monta o lead a partir do banco e envia. Chamado nos dois gatilhos; barato
 * quando a integração está desligada (uma leitura de config cacheada).
 */
export async function notificarCrm(evento: Exclude<EventoCrm, 'teste'>, contactId: string): Promise<ResultadoEnvio> {
  try {
    const creds = await getChannelCredentials('crm')
    if (!creds.isActive || !creds.webhookUrl || !creds.verifyToken) {
      return { enviado: false, motivo: 'integração não configurada' }
    }

    const supabase = createAdminClient()
    const { data: contato } = await supabase
      .from('contacts')
      .select('id, name, phone, channel_default, funnel_stage, intent, registration_id')
      .eq('id', contactId)
      .maybeSingle()
    if (!contato) return { enviado: false, motivo: 'contato não encontrado' }

    /* Dados do cadastro formal SEM as colunas de CPF: a query nem as seleciona,
       para o payload não ter como carregá-las por descuido de refactor. */
    let cadastro: LeadDoEvento['cadastro'] = null
    if (contato.registration_id) {
      const [{ data: reg }, { data: papeis }] = await Promise.all([
        supabase.from('registrations').select('id, full_name, email').eq('id', contato.registration_id).maybeSingle(),
        supabase.from('contact_roles').select('role').eq('registration_id', contato.registration_id),
      ])
      if (reg) {
        cadastro = {
          registration_id: reg.id,
          nome: reg.full_name ?? null,
          email: reg.email ?? null,
          papeis: (papeis ?? []).map((p) => p.role),
        }
      }
    }

    return enviarParaCrm(
      montarEventoLead(
        evento,
        {
          contact_id: contato.id,
          nome: contato.name ?? null,
          telefone: contato.phone ?? null,
          canal: contato.channel_default ?? null,
          funil: contato.funnel_stage ?? null,
          intencao: contato.intent ?? null,
          cadastro,
        },
        new Date()
      ),
      { contactId: contato.id }
    )
  } catch (e) {
    console.warn('[crm] notificação falhou:', (e as Error).message)
    return { enviado: false, motivo: 'erro interno ao montar o evento' }
  }
}
