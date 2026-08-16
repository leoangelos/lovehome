// ==========================================
// Gestao dos campos configuraveis do formulario (PRD 6.5, Marco 4).
//
// Fora da rota HTTP para ser testavel sem sessao.
//
// A regra que sustenta o resto: campo extra NUNCA participa do gate da secao
// 6.3. `registration_status` continua derivando de CPF + nome + e-mail +
// endereco + papel, e nada nesta tela muda isso. Um campo obrigatorio novo
// impede o ENVIO do formulario; nao redefine o que e um cadastro completo.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import {
  validarDefinicao,
  TIPOS_COM_OPCOES,
  type CampoFormulario,
  type TipoCampo,
} from './campos-formato'

export type ResultadoCampo =
  | { ok: true; id: string }
  | { ok: false; erro: string; status: number; campo?: string }

interface LinhaBruta {
  id: string
  form_type: string
  chave: string
  rotulo: string
  ajuda: string | null
  tipo: string
  opcoes: unknown
  obrigatorio: boolean
  papeis: unknown
  posicao: number
  is_active: boolean
}

function normalizar(l: LinhaBruta): CampoFormulario {
  return {
    id: l.id,
    form_type: l.form_type as CampoFormulario['form_type'],
    chave: l.chave,
    rotulo: l.rotulo,
    ajuda: l.ajuda,
    tipo: l.tipo as TipoCampo,
    opcoes: Array.isArray(l.opcoes) ? (l.opcoes as string[]) : [],
    obrigatorio: l.obrigatorio,
    papeis: Array.isArray(l.papeis) ? (l.papeis as string[]) : [],
    posicao: l.posicao,
    is_active: l.is_active,
  }
}

const COLUNAS = 'id, form_type, chave, rotulo, ajuda, tipo, opcoes, obrigatorio, papeis, posicao, is_active'

/** Tudo, inclusive inativo — a tela de admin precisa ver o que desligou. */
export async function listarCampos(
  formType: CampoFormulario['form_type'] = 'cadastro'
): Promise<CampoFormulario[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('form_fields')
    .select(COLUNAS)
    .eq('form_type', formType)
    .order('posicao')
    .order('created_at')

  if (error) throw new Error(`Falha ao listar campos: ${error.message}`)
  return (data ?? []).map((l) => normalizar(l as LinhaBruta))
}

/** So o que o formulario publico deve perguntar. */
export async function listarCamposAtivos(
  formType: CampoFormulario['form_type'] = 'cadastro'
): Promise<CampoFormulario[]> {
  return (await listarCampos(formType)).filter((c) => c.is_active)
}

export async function salvarCampo(params: {
  id?: string
  form_type?: CampoFormulario['form_type']
  chave: string
  rotulo: string
  ajuda?: string | null
  tipo: TipoCampo
  opcoes?: string[]
  obrigatorio?: boolean
  papeis?: string[]
  is_active?: boolean
  email: string
}): Promise<ResultadoCampo> {
  const formType = params.form_type ?? 'cadastro'
  const chave = params.chave?.trim().toLowerCase() ?? ''

  const problemas = validarDefinicao({ ...params, chave })
  if (problemas.length) {
    return { ok: false, erro: problemas[0].mensagem, status: 400, campo: problemas[0].campo }
  }

  const supabase = createAdminClient()

  /* Chave duplicada dentro do mesmo formulario: o UNIQUE do banco pegaria, mas
     devolveria erro de constraint em vez de uma frase que a pessoa entende. */
  const { data: colisao } = await supabase
    .from('form_fields')
    .select('id')
    .eq('form_type', formType)
    .eq('chave', chave)
    .maybeSingle()

  if (colisao && colisao.id !== params.id) {
    return { ok: false, erro: `Já existe um campo com a chave "${chave}".`, status: 409, campo: 'chave' }
  }

  const opcoes = TIPOS_COM_OPCOES.includes(params.tipo)
    ? (params.opcoes ?? []).map((o) => o.trim()).filter(Boolean)
    : []

  const linha = {
    form_type: formType,
    chave,
    rotulo: params.rotulo.trim(),
    ajuda: params.ajuda?.trim() || null,
    tipo: params.tipo,
    opcoes,
    obrigatorio: params.obrigatorio ?? false,
    papeis: params.papeis ?? [],
    is_active: params.is_active ?? true,
    updated_at: new Date().toISOString(),
  }

  if (params.id) {
    const { data: anterior } = await supabase
      .from('form_fields')
      .select('chave')
      .eq('id', params.id)
      .maybeSingle()

    if (!anterior) return { ok: false, erro: 'Campo não encontrado.', status: 404 }

    /* A chave e o endereco da resposta dentro de `registrations.extra`. Trocar
       depois de ja ter coletado deixaria as respostas antigas orfas: gravadas
       sob um nome que nenhuma definicao reconhece, invisiveis no painel e
       impossiveis de exportar. */
    if (anterior.chave !== chave) {
      const { count } = await supabase
        .from('registrations')
        .select('id', { count: 'exact', head: true })
        .not(`extra->${anterior.chave}`, 'is', null)

      if ((count ?? 0) > 0) {
        return {
          ok: false,
          erro: `Já há ${count} cadastro(s) respondido(s) com a chave "${anterior.chave}". Mudar a chave deixaria essas respostas órfãs — crie um campo novo.`,
          status: 409,
          campo: 'chave',
        }
      }
    }

    const { error } = await supabase.from('form_fields').update(linha).eq('id', params.id)
    if (error) {
      console.error('[campos] atualização falhou:', error.message)
      return { ok: false, erro: 'Não foi possível salvar.', status: 500 }
    }
    console.log(`[campos] ${params.email} editou o campo "${chave}"`)
    return { ok: true, id: params.id }
  }

  // Novo campo entra no fim da lista.
  const { data: ultimo } = await supabase
    .from('form_fields')
    .select('posicao')
    .eq('form_type', formType)
    .order('posicao', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await supabase
    .from('form_fields')
    .insert({ ...linha, posicao: (ultimo?.posicao ?? -1) + 1 })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[campos] criação falhou:', error?.message)
    return { ok: false, erro: 'Não foi possível criar o campo.', status: 500 }
  }

  console.log(`[campos] ${params.email} criou o campo "${chave}" (${params.tipo})`)
  return { ok: true, id: data.id }
}

/**
 * Apaga a definicao. Recusa se ja houver resposta gravada.
 *
 * A resposta mora em `registrations.extra`, nao aqui — apagar a definicao nao
 * apaga o dado, deixa ele sem rotulo. O painel passaria a mostrar
 * `renda_mensal: 8000` sem saber o que a pergunta era, e ninguem entenderia se
 * aquilo era renda mensal, anual ou familiar. Desativar resolve o caso real
 * ("pare de perguntar isso") sem criar dado ilegivel.
 */
export async function removerCampo(id: string, email: string): Promise<ResultadoCampo> {
  const supabase = createAdminClient()

  const { data: alvo } = await supabase
    .from('form_fields')
    .select('id, chave, rotulo')
    .eq('id', id)
    .maybeSingle()

  if (!alvo) return { ok: false, erro: 'Campo não encontrado.', status: 404 }

  const { count } = await supabase
    .from('registrations')
    .select('id', { count: 'exact', head: true })
    .not(`extra->${alvo.chave}`, 'is', null)

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      erro: `${count} cadastro(s) já responderam "${alvo.rotulo}". Apagar deixaria essas respostas sem rótulo no painel — desative o campo para parar de perguntar.`,
      status: 409,
    }
  }

  const { error } = await supabase.from('form_fields').delete().eq('id', id)
  if (error) return { ok: false, erro: 'Não foi possível remover.', status: 500 }

  console.log(`[campos] ${email} removeu o campo "${alvo.chave}"`)
  return { ok: true, id }
}

/** Reordena pela lista inteira de ids — a tela manda a ordem final. */
export async function reordenarCampos(
  ids: string[],
  email: string
): Promise<{ ok: boolean; erro?: string }> {
  const supabase = createAdminClient()

  for (const [indice, id] of ids.entries()) {
    const { error } = await supabase
      .from('form_fields')
      .update({ posicao: indice, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return { ok: false, erro: 'Não foi possível reordenar.' }
  }

  console.log(`[campos] ${email} reordenou ${ids.length} campo(s)`)
  return { ok: true }
}

/**
 * Quantos cadastros ja responderam cada campo. A tela usa para avisar antes de
 * uma remocao que sera recusada, em vez de deixar a pessoa descobrir no erro.
 */
export async function contarRespostas(
  campos: CampoFormulario[]
): Promise<Record<string, number>> {
  const supabase = createAdminClient()
  const contagem: Record<string, number> = {}

  for (const campo of campos) {
    const { count } = await supabase
      .from('registrations')
      .select('id', { count: 'exact', head: true })
      .not(`extra->${campo.chave}`, 'is', null)
    contagem[campo.chave] = count ?? 0
  }

  return contagem
}
