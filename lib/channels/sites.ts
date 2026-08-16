// ==========================================
// Sites autorizados a embutir o widget (`widget_sites`).
//
// A validação de origem existe desde o widget (lib/widget/protecao.ts), mas não
// havia como cadastrar um site — a tabela só podia ser preenchida por SQL. Isto
// é essa ponta.
//
// A origem é normalizada na GRAVAÇÃO, não só na comparação: quem digita costuma
// colar a URL da página ("https://site.com.br/imoveis/") em vez da origem, e
// guardar isso cru faria o CORS recusar um site que a pessoa jura ter
// cadastrado. Normalizar aqui evita um suporte inteiro.
// ==========================================

import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

export interface SiteWidget {
  id: string
  site_id: string
  origin: string
  name: string | null
  is_active: boolean
  created_at: string
}

export type Resultado = { ok: true; siteId?: string } | { ok: false; erro: string; status: number }

/** Reduz o que a pessoa digitou a `scheme://host[:porta]`, que é o que o navegador manda. */
export function normalizarOrigem(valor: string): string | null {
  const bruto = valor.trim().toLowerCase()
  if (!bruto) return null

  const comEsquema = /^https?:\/\//.test(bruto) ? bruto : `https://${bruto}`

  try {
    const url = new URL(comEsquema.replace(/\/\*$/, ''))
    if (!url.host) return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

export async function listarSites(): Promise<SiteWidget[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('widget_sites')
    .select('id, site_id, origin, name, is_active, created_at')
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Falha ao listar sites: ${error.message}`)
  return (data ?? []) as SiteWidget[]
}

export async function cadastrarSite(params: {
  origem: string
  nome?: string | null
  email: string
}): Promise<Resultado> {
  const origem = normalizarOrigem(params.origem)
  if (!origem) return { ok: false, erro: 'Endereço inválido. Use algo como https://site.com.br', status: 400 }

  const supabase = createAdminClient()

  const { data: jaExiste } = await supabase
    .from('widget_sites')
    .select('id')
    .eq('origin', origem)
    .maybeSingle()

  if (jaExiste) return { ok: false, erro: 'Este endereço já está cadastrado.', status: 409 }

  /* `site_id` vai no atributo data-site-id do script embutido. Aleatório porque
     ele viaja no HTML de outra pessoa: derivar do domínio deixaria qualquer um
     adivinhar o de um concorrente e tentar usá-lo. */
  const siteId = crypto.randomBytes(12).toString('base64url')

  const { error } = await supabase.from('widget_sites').insert({
    site_id: siteId,
    origin: origem,
    name: params.nome?.trim() || null,
    is_active: true,
  })

  if (error) {
    console.error('[canais] cadastro de site falhou:', error.message)
    return { ok: false, erro: 'Não foi possível cadastrar.', status: 500 }
  }

  console.log(`[canais] ${params.email} autorizou o widget em ${origem}`)
  return { ok: true, siteId }
}

export async function alternarSite(id: string, ativo: boolean, email: string): Promise<Resultado> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('widget_sites').update({ is_active: ativo }).eq('id', id)

  if (error) return { ok: false, erro: 'Não foi possível alterar.', status: 500 }

  console.log(`[canais] ${email} ${ativo ? 'reativou' : 'desativou'} o site ${id}`)
  return { ok: true }
}

export async function removerSite(id: string, email: string): Promise<Resultado> {
  const supabase = createAdminClient()

  const { data: site } = await supabase
    .from('widget_sites')
    .select('origin')
    .eq('id', id)
    .maybeSingle()

  if (!site) return { ok: false, erro: 'Site não encontrado.', status: 404 }

  const { error } = await supabase.from('widget_sites').delete().eq('id', id)
  if (error) return { ok: false, erro: 'Não foi possível remover.', status: 500 }

  console.log(`[canais] ${email} removeu a autorização de ${site.origin}`)
  return { ok: true }
}
