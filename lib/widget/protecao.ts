// ==========================================
// Proteções do widget web (PRD 8, canal widget).
//
// As rotas do widget são as ÚNICAS do sistema que aceitam requisição anônima e
// gastam dinheiro: cada mensagem vira chamada de LLM. Webhook tem segredo,
// painel tem sessão, formulário público tem token de uso único — o widget não
// tem nada disso, porque quem usa é um visitante que acabou de chegar no site.
//
// O que substitui a credencial, então:
//   1. ORIGEM registrada — só site cadastrado em `widget_sites` recebe CORS.
//   2. LIMITE por sessão e por IP — teto de mensagens numa janela.
//   3. TOKEN gerado no servidor — o cliente nunca escolhe o próprio identificador.
// ==========================================

import crypto from 'crypto'
import { redis } from '@/lib/redis/client'
import { validateWidgetOrigin } from '@/lib/channels/widget'

/** Mensagens por sessão numa janela — cobre o visitante em laço. */
const LIMITE_SESSAO = { max: 20, janelaSegundos: 300 }
/** Mensagens por IP — cobre quem abre sessão nova a cada mensagem. */
const LIMITE_IP = { max: 60, janelaSegundos: 600 }
/** Sessões novas por IP — cobre quem só quer encher a tabela. */
const LIMITE_SESSOES_NOVAS = { max: 15, janelaSegundos: 3600 }

export const MAX_CARACTERES_MENSAGEM = 1500

/** Token de sessão: 32 bytes de urandom, gerado SEMPRE no servidor.
 *
 * Se o cliente escolhesse o próprio token, bastaria adivinhar o de outro
 * visitante para ler a conversa dele — e o histórico do widget é conversa com
 * um corretor, com região, faixa de preço e às vezes nome. */
export function gerarTokenSessao(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/** IP nunca é guardado em claro: vira HMAC com a chave da aplicação. */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null
  const chave = process.env.APP_ENCRYPTION_KEY
  if (!chave) return null
  return crypto.createHmac('sha256', chave).update(ip).digest('hex').slice(0, 32)
}

export function ipDaRequisicao(request: Request): string | null {
  const encaminhado = request.headers.get('x-forwarded-for')
  if (encaminhado) return encaminhado.split(',')[0].trim()
  return request.headers.get('x-real-ip')
}

/**
 * Cabeçalhos de CORS para uma origem JÁ VALIDADA.
 *
 * Devolve a origem específica, nunca '*': o widget manda o token de sessão no
 * corpo, e liberar qualquer origem deixaria qualquer página da web conversar em
 * nome de uma sessão que ela conseguisse observar.
 */
export function cabecalhosCors(origem: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origem,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export type ResultadoOrigem =
  | { permitida: true; origem: string; headers: Record<string, string> }
  | { permitida: false }

function mesmaOrigem(origem: string, alvo: string | undefined): boolean {
  if (!alvo) return false
  try {
    return new URL(origem).host.toLowerCase() === new URL(alvo).host.toLowerCase()
  } catch {
    return false
  }
}

/**
 * Resolve a origem contra `widget_sites`.
 *
 * Duas exceções ao cadastro, e as duas são deliberadas:
 *
 * - A ORIGEM DO PRÓPRIO APP (`NEXT_PUBLIC_APP_URL`) sempre passa. A vitrine
 *   embute o mesmo widget que um site de terceiro embutiria, e exigir que ela
 *   se cadastre em `widget_sites` para conversar consigo mesma significaria um
 *   widget quebrado em produção até alguém lembrar de inserir a linha — falha
 *   silenciosa, descoberta pelo visitante.
 * - `localhost` passa em desenvolvimento, senão seria preciso semear uma linha
 *   só para abrir o site na própria máquina. Em produção essa não vale.
 */
export async function resolverOrigem(
  request: Request,
  siteId: string | null
): Promise<ResultadoOrigem> {
  const origem = request.headers.get('origin')
  if (!origem) return { permitida: false }

  if (mesmaOrigem(origem, process.env.NEXT_PUBLIC_APP_URL)) {
    return { permitida: true, origem, headers: cabecalhosCors(origem) }
  }

  const ehLocal =
    process.env.NODE_ENV !== 'production' &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origem)

  if (ehLocal) return { permitida: true, origem, headers: cabecalhosCors(origem) }

  const validada = await validateWidgetOrigin(siteId, origem)
  if (!validada) return { permitida: false }

  return { permitida: true, origem: validada, headers: cabecalhosCors(validada) }
}

async function contar(chave: string, janelaSegundos: number): Promise<number> {
  const atual = await redis.incr(chave)
  // Só a primeira incrementação define a janela; senão ela nunca expiraria.
  if (atual === 1) await redis.expire(chave, janelaSegundos)
  return atual
}

export type ResultadoLimite = { dentro: true } | { dentro: false; motivo: string }

export async function limitarMensagem(
  sessionToken: string,
  ipHash: string | null
): Promise<ResultadoLimite> {
  const porSessao = await contar(`widget:rl:sess:${sessionToken}`, LIMITE_SESSAO.janelaSegundos)
  if (porSessao > LIMITE_SESSAO.max) {
    return { dentro: false, motivo: 'Muitas mensagens seguidas. Aguarde alguns minutos.' }
  }

  if (ipHash) {
    const porIp = await contar(`widget:rl:ip:${ipHash}`, LIMITE_IP.janelaSegundos)
    if (porIp > LIMITE_IP.max) {
      return { dentro: false, motivo: 'Muitas mensagens seguidas. Aguarde alguns minutos.' }
    }
  }

  return { dentro: true }
}

export async function limitarSessaoNova(ipHash: string | null): Promise<ResultadoLimite> {
  if (!ipHash) return { dentro: true }
  const n = await contar(`widget:rl:novasess:${ipHash}`, LIMITE_SESSOES_NOVAS.janelaSegundos)
  if (n > LIMITE_SESSOES_NOVAS.max) {
    return { dentro: false, motivo: 'Muitas sessões abertas deste endereço.' }
  }
  return { dentro: true }
}
