import { createAdminClient } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/crypto/encrypt'
import { area, brl, data as formatarData } from '@/lib/utils/format'

// ==========================================
// Preenchimento do contrato a partir do template (PRD 15.1).
//
// ESTE É O ÚNICO LUGAR DO SISTEMA QUE DESCRIPTOGRAFA CPF.
// A seção 6.2 prevê exatamente isso: `cpf_encrypted` é reversível só
// server-side e só quando há necessidade real — contrato é documento legal e
// precisa do número inteiro. Em qualquer outro lugar, use `cpf_last4`.
//
// Nada aqui loga o CPF. O texto preenchido volta para quem chamou, vira PDF e
// vai para um bucket PRIVADO; não passa por console nem por resposta de API.
// ==========================================

const ROTULO_FINANCIAMENTO: Record<string, string> = {
  a_vista: 'à vista',
  financiado: 'financiado',
  consorcio: 'consórcio',
}

/** '12345678909' → '123.456.789-09' */
function formatarCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11) return cpf
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

function enderecoDe(address: unknown): string {
  if (!address || typeof address !== 'object') return 'endereço não informado'
  const a = address as Record<string, string>
  const partes = [
    a.street && a.number ? `${a.street}, ${a.number}` : a.street,
    a.complement,
    a.neighborhood,
    a.city && a.state ? `${a.city}/${a.state}` : a.city,
    a.zip,
  ].filter(Boolean)
  return partes.length ? partes.join(' — ') : 'endereço não informado'
}

export interface ContratoPreenchido {
  texto: string
  templateId: string
  dealType: 'locacao' | 'venda'
  referenciaImovel: string
  nomeCliente: string
  /** Placeholders que ficaram sem dado — a tela avisa antes de gerar. */
  lacunas: string[]
}

export type ResultadoContrato =
  | { ok: true; contrato: ContratoPreenchido }
  | { ok: false; erro: string }

export async function preencherContrato(dealId: string): Promise<ResultadoContrato> {
  const supabase = createAdminClient()

  const { data: negocio } = await supabase
    .from('deals')
    .select(
      `id, deal_type, status, rent_price_cents, sale_price_cents, down_payment_cents,
       financing_type, itbi_status, start_date, end_date, notice_period_days,
       client_registration_id, owner_registration_id,
       properties ( id, reference_code, property_type, address, region, city, area_m2, bedrooms, condo_fee_cents, owner_registration_id )`
    )
    .eq('id', dealId)
    .maybeSingle()

  if (!negocio) return { ok: false, erro: 'Negócio não encontrado.' }

  /* Contrato só nasce de negócio aprovado. É o portão da seção 15.2: revisão
     dos documentos → aprovação humana → contrato. Gerar antes daria ao cliente
     um documento que ninguém autorizou. */
  if (negocio.status !== 'aprovado' && negocio.status !== 'ativo') {
    return {
      ok: false,
      erro: `O negócio precisa estar aprovado para gerar contrato (está "${negocio.status}").`,
    }
  }

  const { data: template } = await supabase
    .from('contract_templates')
    .select('id, body_template')
    .eq('deal_type', negocio.deal_type)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!template) {
    return { ok: false, erro: `Não há template ativo para ${negocio.deal_type}.` }
  }

  const { data: cliente } = await supabase
    .from('registrations')
    .select('full_name, email, address, cpf_encrypted')
    .eq('id', negocio.client_registration_id)
    .maybeSingle()

  if (!cliente) return { ok: false, erro: 'Cadastro do cliente não encontrado.' }

  const imovel = negocio.properties as unknown as {
    id: string
    owner_registration_id: string | null
    reference_code: string
    property_type: string
    address: string | null
    region: string
    city: string
    area_m2: number | null
    bedrooms: number | null
    condo_fee_cents: number | null
  } | null

  /* `deals.owner_registration_id` é um retrato tirado na reserva. Quando o
     imóvel ainda não tinha dono cadastrado naquele momento, o campo ficou nulo —
     e vincular o proprietário ao imóvel depois NÃO consertava o contrato, que
     continuava saindo com o LOCADOR em branco.
     Aqui o retrato é completado a partir do imóvel e gravado de volta no
     negócio, para virar snapshot estável a partir de agora. O retrato importa:
     se o imóvel for vendido, o contrato antigo deve continuar apontando para
     quem era dono na época. */
  let ownerId = negocio.owner_registration_id
  if (!ownerId && imovel?.owner_registration_id) {
    ownerId = imovel.owner_registration_id
    await supabase
      .from('deals')
      .update({ owner_registration_id: ownerId, updated_at: new Date().toISOString() })
      .eq('id', dealId)
  }

  const { data: proprietario } = ownerId
    ? await supabase
        .from('registrations')
        .select('full_name, cpf_encrypted')
        .eq('id', ownerId)
        .maybeSingle()
    : { data: null }

  const lacunas: string[] = []
  const ou = (valor: string | null | undefined, rotulo: string) => {
    if (valor) return valor
    lacunas.push(rotulo)
    return `[${rotulo.toUpperCase()} NÃO INFORMADO]`
  }

  const valores: Record<string, string> = {
    tenant_name: cliente.full_name,
    tenant_cpf: formatarCpf(decryptSecret(cliente.cpf_encrypted)),
    tenant_email: ou(cliente.email, 'e-mail do cliente'),
    tenant_address: enderecoDe(cliente.address),

    owner_name: ou(proprietario?.full_name, 'nome do proprietário'),
    owner_cpf: proprietario?.cpf_encrypted
      ? formatarCpf(decryptSecret(proprietario.cpf_encrypted))
      : ou(null, 'CPF do proprietário'),

    property_code: imovel?.reference_code ?? '—',
    property_type: imovel?.property_type ?? 'imóvel',
    property_address: ou(imovel?.address, 'endereço do imóvel'),
    property_region: imovel?.region ?? '—',
    property_city: imovel?.city ?? 'São Paulo',
    property_area: imovel?.area_m2 ? area(imovel.area_m2) : 'área não informada',
    property_bedrooms: imovel?.bedrooms != null ? String(imovel.bedrooms) : '—',

    rent_price: negocio.rent_price_cents ? brl(negocio.rent_price_cents) : '—',
    condo_fee: imovel?.condo_fee_cents ? brl(imovel.condo_fee_cents) : 'R$ 0,00',
    start_date: negocio.start_date ? formatarData(negocio.start_date) : ou(null, 'data de início'),
    end_date: negocio.end_date ? formatarData(negocio.end_date) : ou(null, 'data de término'),
    notice_period_days: String(negocio.notice_period_days ?? 30),

    sale_price: negocio.sale_price_cents ? brl(negocio.sale_price_cents) : '—',
    down_payment: negocio.down_payment_cents
      ? brl(negocio.down_payment_cents)
      : ou(null, 'valor do sinal'),
    financing_type: negocio.financing_type
      ? ROTULO_FINANCIAMENTO[negocio.financing_type]
      : ou(null, 'forma de pagamento'),
    itbi_status: negocio.itbi_status === 'pago' ? 'pago' : 'pendente',

    today: new Date().toLocaleDateString('pt-BR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  }

  const corpo = template.body_template

  const texto = corpo.replace(
    /\{\{(\w+)\}\}/g,
    (_original: string, chave: string) => valores[chave] ?? `[${chave}]`
  )

  /* Lacuna só conta se o placeholder existe NESTE template. Sem o filtro, o
     contrato de locação reclamava de "valor do sinal" e "forma de pagamento" —
     campos de venda, que a montagem dos valores avalia de qualquer jeito. Aviso
     sobre campo inexistente faz quem revisa procurar problema que não há. */
  const usados = new Set(
    [...corpo.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
  )
  const rotuloPorChave: Record<string, string> = {
    tenant_email: 'e-mail do cliente',
    owner_name: 'nome do proprietário',
    owner_cpf: 'CPF do proprietário',
    property_address: 'endereço do imóvel',
    start_date: 'data de início',
    end_date: 'data de término',
    down_payment: 'valor do sinal',
    financing_type: 'forma de pagamento',
  }
  const lacunasRelevantes = lacunas.filter((rotulo) =>
    [...usados].some((chave) => rotuloPorChave[chave] === rotulo)
  )

  return {
    ok: true,
    contrato: {
      texto,
      templateId: template.id,
      dealType: negocio.deal_type as 'locacao' | 'venda',
      referenciaImovel: imovel?.reference_code ?? dealId.slice(0, 8),
      nomeCliente: cliente.full_name,
      lacunas: [...new Set(lacunasRelevantes)],
    },
  }
}
