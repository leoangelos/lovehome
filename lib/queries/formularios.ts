import { createAdminClient } from '@/lib/supabase/admin'

/* Leitura da tela de formulários (PRD 6.5).
 *
 * Duas coisas convivem aqui e é importante não confundi-las:
 *
 *  1. O ACOMPANHAMENTO dos links enviados — quem recebeu, quem preencheu, o que
 *     expirou sem resposta. Serve para o corretor cobrar quem ficou pelo
 *     caminho.
 *  2. A FILA DE CONFERÊNCIA de CPF já cadastrado. Essa é a parte sensível:
 *     `submeterCadastro` se recusa a vincular sozinho quando o CPF já existe,
 *     porque o token está preso a um número de WhatsApp e CPF de terceiro é
 *     fácil de obter no Brasil. A decisão é humana, e é aqui que ela acontece.
 *
 * Nenhuma consulta seleciona cpf_hash ou cpf_encrypted — só cpf_last4.
 */

export type TipoFormulario = 'cadastro' | 'listagem_imovel'
export type StatusFormulario = 'pendente' | 'preenchido' | 'expirado'
export type DecisaoRevisao = 'vinculado' | 'recusado'

export interface CadastroEmConflito {
  id: string
  full_name: string
  email: string | null
  cpf_last4: string | null
  created_at: string
  papeis: string[]
}

export interface FormularioLinha {
  id: string
  form_type: TipoFormulario
  status: StatusFormulario
  created_at: string
  submitted_at: string | null
  expires_at: string | null

  contato_id: string | null
  contato_nome: string | null
  contato_telefone: string | null
  /** Contato já tem cadastro vinculado — relevante para julgar o conflito. */
  contato_ja_vinculado: boolean

  /** Preenchido só quando a submissão está retida por CPF já cadastrado. */
  conflito: {
    /** O que a pessoa digitou agora. */
    informado: { full_name: string | null; email: string | null; papeis: string[] }
    /** O cadastro que já existia com aquele CPF. */
    existente: CadastroEmConflito | null
    decisao: DecisaoRevisao | null
    decidido_por: string | null
    decidido_em: string | null
    motivo: string | null
  } | null

  /** Só para listagem_imovel: título do rascunho, para dar contexto na linha. */
  resumo_listagem: string | null
}

export { ROTULO_TIPO_FORMULARIO as ROTULO_TIPO } from '@/lib/ui/rotulos'

interface PayloadRevisao {
  motivo_revisao?: string
  full_name?: string
  email?: string
  roles?: string[]
  registration_id_conflito?: string
  revisao_decisao?: DecisaoRevisao
  revisao_por?: string
  revisao_em?: string
  revisao_motivo?: string
  title?: string
  address?: { neighborhood?: string; city?: string }
}

export async function listarFormularios(): Promise<FormularioLinha[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('form_submissions')
    .select(
      `id, form_type, status, created_at, submitted_at, expires_at, payload, contact_id,
       contacts ( name, phone, registration_id )`
    )
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(`Falha ao listar formulários: ${error.message}`)

  const linhas = data ?? []

  /* Os cadastros em conflito vêm em uma consulta só. Buscar um por linha
     multiplicaria ida e volta ao banco numa tela que lista 200. */
  const idsConflito = [
    ...new Set(
      linhas
        .map((l) => (l.payload as PayloadRevisao | null)?.registration_id_conflito)
        .filter((v): v is string => Boolean(v))
    ),
  ]

  const porId = new Map<string, CadastroEmConflito>()
  if (idsConflito.length) {
    const { data: cadastros } = await supabase
      .from('registrations')
      .select('id, full_name, email, cpf_last4, created_at, contact_roles ( role )')
      .in('id', idsConflito)

    for (const c of cadastros ?? []) {
      const papeis = (c.contact_roles as unknown as { role: string }[] | null) ?? []
      porId.set(c.id, {
        id: c.id,
        full_name: c.full_name,
        email: c.email,
        cpf_last4: c.cpf_last4,
        created_at: c.created_at,
        papeis: papeis.map((p) => p.role),
      })
    }
  }

  return linhas.map((l) => {
    const payload = (l.payload ?? {}) as PayloadRevisao
    const contato = l.contacts as unknown as {
      name: string | null
      phone: string | null
      registration_id: string | null
    } | null

    const emConflito = payload.motivo_revisao === 'cpf_ja_cadastrado'

    return {
      id: l.id,
      form_type: l.form_type as TipoFormulario,
      status: l.status as StatusFormulario,
      created_at: l.created_at,
      submitted_at: l.submitted_at,
      expires_at: l.expires_at,

      contato_id: l.contact_id,
      contato_nome: contato?.name ?? null,
      contato_telefone: contato?.phone ?? null,
      contato_ja_vinculado: Boolean(contato?.registration_id),

      conflito: emConflito
        ? {
            informado: {
              full_name: payload.full_name ?? null,
              email: payload.email ?? null,
              papeis: payload.roles ?? [],
            },
            existente: payload.registration_id_conflito
              ? (porId.get(payload.registration_id_conflito) ?? null)
              : null,
            decisao: payload.revisao_decisao ?? null,
            decidido_por: payload.revisao_por ?? null,
            decidido_em: payload.revisao_em ?? null,
            motivo: payload.revisao_motivo ?? null,
          }
        : null,

      resumo_listagem:
        l.form_type === 'listagem_imovel'
          ? (payload.title ??
            [payload.address?.neighborhood, payload.address?.city].filter(Boolean).join(', ') ??
            null)
          : null,
    }
  })
}

/** Casos esperando decisão humana — o número que vira contador na tela. */
export function aguardandoConferencia(linhas: FormularioLinha[]): FormularioLinha[] {
  return linhas.filter((l) => l.conflito && !l.conflito.decisao)
}
