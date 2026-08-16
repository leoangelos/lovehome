// ==========================================
// Cliente HTTP do Asaas (PRD 14).
//
// Mesmo padrão das outras integrações externas: credencial cifrada em
// `channel_configs` (channel='asaas'), com fallback para variável de ambiente
// enquanto a linha não foi preenchida pelo painel.
//
// A URL base vem do ambiente porque ela distingue SANDBOX de PRODUÇÃO — e essa
// é a única configuração cuja troca por engano move dinheiro de verdade. Deixá-la
// junto das outras, editável por uma tela, tornaria fácil demais apontar para
// produção sem perceber.
// ==========================================

import { getChannelCredentials } from '@/lib/channels/config'

const BASE_PADRAO = 'https://api-sandbox.asaas.com'

export interface RespostaAsaas<T> {
  ok: boolean
  status: number
  dados: T | null
  erro: string | null
}

function baseUrl(): string {
  const bruta = (process.env.ASAAS_BASE_URL || BASE_PADRAO).trim().replace(/\/+$/, '')
  /* A API vive em /v3. Aceitar a URL com ou sem ele evita o erro mais comum de
     configuração — colar a raiz e receber 404 em tudo. */
  return bruta.endsWith('/v3') ? bruta : `${bruta}/v3`
}

export function emProducao(): boolean {
  return !/sandbox/i.test(process.env.ASAAS_BASE_URL || BASE_PADRAO)
}

async function chaveApi(): Promise<string | null> {
  const creds = await getChannelCredentials('asaas')
  return creds.accessToken || process.env.ASAAS_API_KEY || null
}

/** Segredo que o Asaas devolve no header do webhook, para conferirmos. */
export async function tokenWebhook(): Promise<string | null> {
  const creds = await getChannelCredentials('asaas')
  return creds.verifyToken || process.env.ASAAS_WEBHOOK_TOKEN || null
}

export async function chamarAsaas<T>(
  caminho: string,
  init?: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> }
): Promise<RespostaAsaas<T>> {
  const chave = await chaveApi()
  if (!chave) {
    return { ok: false, status: 0, dados: null, erro: 'Credencial do Asaas não configurada.' }
  }

  const url = new URL(`${baseUrl()}${caminho}`)
  for (const [k, v] of Object.entries(init?.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }

  try {
    const r = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        access_token: chave,
        /* O Asaas usa este cabeçalho para rastrear integrações; ajuda o suporte
           deles quando algo diverge. */
        User_Agent: 'LoveHome',
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    })

    const texto = await r.text()
    const corpo = texto ? JSON.parse(texto) : null

    if (!r.ok) {
      /* O Asaas devolve `errors: [{code, description}]`. Repassar a descrição é
         o que permite alguém entender "CPF inválido" sem abrir log de servidor. */
      const descricao =
        (corpo?.errors as { description?: string }[] | undefined)?.[0]?.description ??
        `HTTP ${r.status}`
      console.error(`[asaas] ${init?.method ?? 'GET'} ${caminho} falhou:`, descricao)
      return { ok: false, status: r.status, dados: null, erro: descricao }
    }

    return { ok: true, status: r.status, dados: corpo as T, erro: null }
  } catch (e) {
    console.error(`[asaas] ${caminho} não respondeu:`, (e as Error).message)
    return { ok: false, status: 0, dados: null, erro: 'Não foi possível falar com o Asaas.' }
  }
}

/** Teste de credencial: qualquer resposta 200 confirma a chave. */
export async function testarAsaas(): Promise<{ ok: boolean; mensagem: string; detalhe?: string }> {
  const chave = await chaveApi()
  if (!chave) return { ok: false, mensagem: 'Credencial do Asaas não configurada.' }

  const r = await chamarAsaas<{ name?: string; email?: string }>('/myAccount')

  if (!r.ok) {
    return {
      ok: false,
      mensagem: r.status === 401 ? 'Chave recusada pelo Asaas.' : 'O Asaas respondeu com erro.',
      detalhe: r.erro ?? undefined,
    }
  }

  return {
    ok: true,
    mensagem: emProducao()
      ? 'Conectado à conta de PRODUÇÃO — cobranças aqui são reais.'
      : 'Conectado ao sandbox.',
    detalhe: r.dados?.email ?? r.dados?.name ?? undefined,
  }
}
