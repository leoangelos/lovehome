import { NextResponse, after } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { escopoProprio } from '@/lib/auth/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { atualizarEmbeddingDoImovel } from '@/lib/imoveis/embeddings'

/* Edição de imóvel pelo painel.
 *
 * O corretor edita apenas os imóveis atribuídos a ele — é a mesma regra da
 * policy `properties_scope` da §9.3, aplicada aqui porque o painel lê pelo
 * service_role e a RLS não barra nada dentro dele. */

export const dynamic = 'force-dynamic'

/** Campos editáveis. Lista explícita: aceitar o corpo inteiro deixaria o
    cliente escrever em `status`, `embedding` ou `created_at`. */
const TEXTO = ['title', 'property_type', 'region', 'city', 'address', 'description'] as const
const NUMERO = [
  'price_cents',
  'rent_price_cents',
  'condo_fee_cents',
  'bedrooms',
  'suites',
  'bathrooms',
  'parking_spots',
  'area_m2',
] as const

/* Campos que entram no texto do embedding (lib/imoveis/embeddings.ts). Mudar
   qualquer um deles exige regerar o vetor; mudar `status` ou `broker_id`, nao —
   e regerar a toa gasta uma chamada de API por edicao de rotina. */
const AFETAM_EMBEDDING = [
  'title',
  'property_type',
  'region',
  'city',
  'description',
  'bedrooms',
  'bathrooms',
  'parking_spots',
  'area_m2',
  'operation',
  'amenities',
]

const OPERACOES = ['venda', 'aluguel', 'ambos']
const STATUS_EDITAVEIS = ['disponivel', 'inativo']

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('imoveis', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params

  let corpo: Record<string, unknown>
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: imovel } = await supabase
    .from('properties')
    .select('id, broker_id, status, reference_code')
    .eq('id', id)
    .maybeSingle()

  if (!imovel) return NextResponse.json({ erro: 'Imóvel não encontrado.' }, { status: 404 })

  if (escopoProprio(auth.sessao.role) && imovel.broker_id !== auth.sessao.brokerId) {
    return NextResponse.json(
      { erro: 'Este imóvel não está atribuído a você.' },
      { status: 403 }
    )
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  for (const campo of TEXTO) {
    if (corpo[campo] === undefined) continue
    const valor = String(corpo[campo] ?? '').trim()
    patch[campo] = valor || null
  }

  for (const campo of NUMERO) {
    if (corpo[campo] === undefined) continue
    const bruto = corpo[campo]
    if (bruto === null || bruto === '') {
      patch[campo] = null
      continue
    }
    const n = Number(bruto)
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ erro: `Valor inválido em ${campo}.` }, { status: 400 })
    }
    patch[campo] = n
  }

  if (corpo.operation !== undefined) {
    if (!OPERACOES.includes(String(corpo.operation))) {
      return NextResponse.json({ erro: 'Operação inválida.' }, { status: 400 })
    }
    patch.operation = corpo.operation
  }

  if (corpo.amenities !== undefined) {
    const lista = Array.isArray(corpo.amenities) ? corpo.amenities : []
    patch.amenities = lista.map((a) => String(a).trim()).filter(Boolean)
  }

  if (corpo.broker_id !== undefined) {
    patch.broker_id = corpo.broker_id || null
  }

  if (corpo.owner_registration_id !== undefined) {
    const owner = corpo.owner_registration_id ? String(corpo.owner_registration_id) : null

    if (owner) {
      /* Só vincula quem tem o papel de proprietário. Sem esta checagem, um
         cadastro de interessado viraria "dono" do imóvel e entraria como
         LOCADOR no contrato gerado. */
      const { data: papel } = await supabase
        .from('contact_roles')
        .select('id')
        .eq('registration_id', owner)
        .eq('role', 'proprietario')
        .maybeSingle()

      if (!papel) {
        return NextResponse.json(
          { erro: 'Esse cadastro não tem o papel de proprietário.' },
          { status: 400 }
        )
      }
    }
    patch.owner_registration_id = owner
  }

  /* Status editável só entre disponivel e inativo. Tirar de 'reservado' ou
     'alugado' por aqui desfaria um negócio pelas costas do fluxo de contrato,
     e 'em_analise' sai pela tela de aprovação. */
  if (corpo.status !== undefined) {
    if (!STATUS_EDITAVEIS.includes(String(corpo.status))) {
      return NextResponse.json(
        { erro: 'Este status não pode ser alterado por aqui.' },
        { status: 400 }
      )
    }
    if (!STATUS_EDITAVEIS.includes(imovel.status)) {
      return NextResponse.json(
        { erro: `Imóvel "${imovel.status}" — resolva o negócio antes de mudar o status.` },
        { status: 400 }
      )
    }
    patch.status = corpo.status
  }

  const { error } = await supabase.from('properties').update(patch).eq('id', id)
  if (error) return NextResponse.json({ erro: 'Não foi possível salvar.' }, { status: 500 })

  /* Embedding desatualizado nao quebra nada visivelmente — o imovel continua
     achavel pelo filtro estruturado. Ele so para de aparecer bem colocado em
     busca qualitativa, o que ninguem percebe olhando a tela. Por isso regerar
     e automatico, e nao um passo que alguem tem que lembrar de fazer.

     Vai por `after()`: acontece depois da resposta, entao a edicao nao fica
     esperando a API de embedding, e continua rodando no Vercel (fogo-e-esquece
     seria interrompido quando o runtime congela). */
  if (AFETAM_EMBEDDING.some((campo) => campo in patch)) {
    after(async () => {
      const ok = await atualizarEmbeddingDoImovel(id)
      if (!ok) console.error(`[properties] embedding de ${imovel.reference_code} nao foi atualizado`)
    })
  }

  console.log(`[properties] ${auth.sessao.email} editou ${imovel.reference_code}`)
  return NextResponse.json({ ok: true })
}
