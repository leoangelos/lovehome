// ==========================================
// Blacklist de contato.
//
// Contato bloqueado nao custa nada: sem Vision, sem transcricao, sem rodada de
// agente, sem resposta. A mensagem recebida continua sendo gravada crua, para o
// historico manter registro do que a pessoa mandou.
//
// Aplicada em todo ponto de entrada (webhooks zapi/meta, widget) e no proprio
// pipeline como rede de seguranca para o que ja estava na fila.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'

export interface BlockableContact {
  blocked?: boolean | null
}

/* Um sinal so, de proposito. Carregar o bloqueio junto de uma classificacao
   de perfil (lead/cliente/vip) tem o efeito ruim de desbloquear sozinho quando
   um evento promove a pessoa de categoria. O schema do
   LoveHome ja nasce com a coluna dedicada, entao nao ha legado a honrar. */
export function isContactBlocked(contact: BlockableContact | null | undefined): boolean {
  if (!contact) return false
  return contact.blocked === true
}

/**
 * Rele o flag direto do banco. Usar quando o contato em memoria pode estar
 * velho — por exemplo, mensagem enfileirada antes de o operador bloquear.
 */
export async function isContactBlockedById(contactId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('contacts')
    .select('blocked')
    .eq('id', contactId)
    .single()

  return isContactBlocked(data)
}

// ==========================================
// Gestão pelo painel.
//
// A coluna `blocked` existia desde a migration 011 e nada no sistema conseguia
// escrevê-la — só um UPDATE manual no banco. Mesmo caso de `widget_sites`: o
// mecanismo estava pronto e faltava a ponta.
// ==========================================

export interface ContatoBloqueado {
  id: string
  name: string | null
  phone: string | null
  channel_default: string
  funnel_stage: string
  last_contact: string | null
}

export async function listarBloqueados(): Promise<ContatoBloqueado[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('contacts')
    .select('id, name, phone, channel_default, funnel_stage, last_contact')
    .eq('blocked', true)
    .order('last_contact', { ascending: false, nullsFirst: false })
    .limit(200)

  if (error) throw new Error(`Falha ao listar bloqueados: ${error.message}`)
  return (data ?? []) as ContatoBloqueado[]
}

export type ResultadoBloqueio =
  | { ok: true; contactId: string; nome: string | null }
  | { ok: false; erro: string; status: number }

/**
 * Bloqueia pelo telefone. Casa pelos últimos 8 dígitos (`phone_key`), a mesma
 * chave da identidade conversacional — quem digita o número raramente acerta o
 * formato exato que está gravado.
 */
export async function bloquearPorTelefone(
  telefone: string,
  email: string
): Promise<ResultadoBloqueio> {
  const digitos = String(telefone ?? '').replace(/\D/g, '')
  if (digitos.length < 8) {
    return { ok: false, erro: 'Informe ao menos 8 dígitos do telefone.', status: 400 }
  }

  const supabase = createAdminClient()
  const chave = digitos.slice(-8)

  const { data: contato } = await supabase
    .from('contacts')
    .select('id, name, blocked')
    .eq('phone_key', chave)
    .maybeSingle()

  /* Só bloqueia quem já conversou. Criar contato para bloquear preventivamente
     encheria a base de linhas fantasmas, e o efeito prático seria o mesmo:
     quando a pessoa escrever, o contato nasce desbloqueado. Se isso virar
     necessidade, é uma tabela de números vetados — não um contato vazio. */
  if (!contato) {
    return {
      ok: false,
      erro: 'Nenhum contato com esse telefone. Só é possível bloquear quem já enviou mensagem.',
      status: 404,
    }
  }

  if (contato.blocked) {
    return { ok: false, erro: 'Este contato já está bloqueado.', status: 409 }
  }

  const { error } = await supabase
    .from('contacts')
    .update({ blocked: true, updated_at: new Date().toISOString() })
    .eq('id', contato.id)

  if (error) return { ok: false, erro: 'Não foi possível bloquear.', status: 500 }

  console.log(`[blocklist] ${email} bloqueou o contato ${contato.id}`)
  return { ok: true, contactId: contato.id, nome: contato.name }
}

export async function desbloquear(contactId: string, email: string): Promise<ResultadoBloqueio> {
  const supabase = createAdminClient()

  const { data: contato } = await supabase
    .from('contacts')
    .select('id, name, blocked')
    .eq('id', contactId)
    .maybeSingle()

  if (!contato) return { ok: false, erro: 'Contato não encontrado.', status: 404 }

  const { error } = await supabase
    .from('contacts')
    .update({ blocked: false, updated_at: new Date().toISOString() })
    .eq('id', contactId)

  if (error) return { ok: false, erro: 'Não foi possível desbloquear.', status: 500 }

  console.log(`[blocklist] ${email} desbloqueou o contato ${contactId}`)
  return { ok: true, contactId, nome: contato.name }
}
