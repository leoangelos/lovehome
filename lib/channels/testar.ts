// ==========================================
// Teste de conexão de canal.
//
// Existe porque credencial errada não dá erro na hora de salvar — ela dá erro
// na primeira mensagem de um cliente real, horas depois, e o sintoma é uma
// conversa sem resposta. O teste antecipa isso para o momento em que a pessoa
// ainda está olhando a tela.
//
// NADA aqui devolve credencial. O retorno é um booleano e uma frase — a
// resposta desta função vai para o navegador.
// ==========================================

import { getChannelCredentials } from './config'
import { enviarParaCrm, montarEventoLead } from '@/lib/crm/webhook'
import { testarAsaas } from '@/lib/asaas/client'
import type { IntegrationChannel } from './types'

export interface ResultadoTeste {
  ok: boolean
  mensagem: string
  /** Detalhe técnico para quem sabe ler. Nunca inclui segredo. */
  detalhe?: string
}

const GRAPH_VERSION = 'v21.0'

export async function testarCanal(canal: IntegrationChannel): Promise<ResultadoTeste> {
  if (canal === 'zapi') return testarZapi()
  if (canal === 'meta') return testarMeta()
  if (canal === 'asaas') return testarAsaas()
  if (canal === 'crm') return testarCrm()
  if (canal === 'widget') {
    return {
      ok: true,
      mensagem: 'O widget não usa credencial — o que autoriza é a lista de sites abaixo.',
    }
  }
  return { ok: false, mensagem: 'Canal sem teste disponível.' }
}

async function testarZapi(): Promise<ResultadoTeste> {
  const creds = await getChannelCredentials('zapi')

  if (!creds.phoneId || !creds.accessToken || !creds.clientToken) {
    return { ok: false, mensagem: 'Faltam credenciais: instância, token e client token.' }
  }

  try {
    const r = await fetch(
      `https://api.z-api.io/instances/${creds.phoneId}/token/${creds.accessToken}/status`,
      { headers: { 'Client-Token': creds.clientToken } }
    )

    if (r.status === 401 || r.status === 403) {
      return { ok: false, mensagem: 'Credenciais recusadas pelo Z-API.', detalhe: `HTTP ${r.status}` }
    }
    if (!r.ok) {
      return { ok: false, mensagem: 'O Z-API respondeu com erro.', detalhe: `HTTP ${r.status}` }
    }

    const corpo = (await r.json()) as { connected?: boolean; smartphoneConnected?: boolean }

    /* `connected: false` é o caso mais comum e o mais confundido: a credencial
       está certa, o celular é que saiu do ar. Dizer isso evita alguém trocar
       um token que estava correto. */
    if (!corpo.connected) {
      return {
        ok: false,
        mensagem: 'Credenciais válidas, mas o celular está desconectado. Leia o QR code no painel do Z-API.',
      }
    }

    return {
      ok: true,
      mensagem: 'Conectado e pronto para enviar.',
      detalhe: corpo.smartphoneConnected ? 'celular online' : 'celular offline',
    }
  } catch (e) {
    return { ok: false, mensagem: 'Não foi possível falar com o Z-API.', detalhe: (e as Error).message }
  }
}

async function testarMeta(): Promise<ResultadoTeste> {
  const creds = await getChannelCredentials('meta')

  const faltando: string[] = []
  if (!creds.phoneId) faltando.push('phone number id')
  if (!creds.accessToken) faltando.push('token de acesso')
  if (!creds.appSecret) faltando.push('app secret')
  if (!creds.verifyToken) faltando.push('verify token')

  if (faltando.length) {
    /* Lista o que falta em vez de só dizer "não configurado": app secret e
       verify token são exigidos pelo webhook e é fácil esquecer um deles. */
    return { ok: false, mensagem: `Falta preencher: ${faltando.join(', ')}.` }
  }

  try {
    const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${creds.phoneId}`, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    })

    if (r.status === 401 || r.status === 403) {
      return { ok: false, mensagem: 'Token recusado pela Meta.', detalhe: `HTTP ${r.status}` }
    }
    if (!r.ok) {
      return { ok: false, mensagem: 'A Meta respondeu com erro.', detalhe: `HTTP ${r.status}` }
    }

    const corpo = (await r.json()) as { display_phone_number?: string; verified_name?: string }
    return {
      ok: true,
      mensagem: 'Token válido e número acessível.',
      detalhe: [corpo.verified_name, corpo.display_phone_number].filter(Boolean).join(' · '),
    }
  } catch (e) {
    return { ok: false, mensagem: 'Não foi possível falar com a Meta.', detalhe: (e as Error).message }
  }
}

async function testarCrm(): Promise<ResultadoTeste> {
  const creds = await getChannelCredentials('crm')
  if (!creds.webhookUrl) return { ok: false, mensagem: 'Cadastre a URL do webhook.' }
  if (!creds.verifyToken) {
    return { ok: false, mensagem: 'Cadastre o segredo de assinatura — sem ele nenhum lead é enviado.' }
  }

  /* Evento 'teste' com lead nulo: prova alcance, assinatura e formato sem
     mandar dado de ninguém. */
  const r = await enviarParaCrm(montarEventoLead('teste', null, new Date()))
  if (r.enviado) {
    return { ok: true, mensagem: 'A URL recebeu o evento de teste assinado.', detalhe: `HTTP ${r.httpStatus}` }
  }
  return {
    ok: false,
    mensagem: creds.isActive
      ? `O envio de teste falhou: ${r.motivo}.`
      : `O envio de teste falhou: ${r.motivo}. A integração também está desativada.`,
    detalhe: r.httpStatus ? `HTTP ${r.httpStatus}` : undefined,
  }
}
