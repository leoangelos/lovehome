'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import type { Property } from '@/lib/types/domain'
import { SelecaoBuscavel } from '@/components/ui/SelecaoBuscavel'

const campoClasse =
  'w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30'
const rotuloClasse = 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5'

const TIPOS = ['apartamento', 'casa', 'studio', 'cobertura', 'sobrado', 'kitnet', 'terreno', 'comercial']

/** Centavos → '820.000,00' para o campo, e de volta na hora de salvar. */
const paraCampo = (c: number | null) =>
  c == null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

const paraCentavos = (v: string): number | null => {
  const limpo = v.replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.')
  if (!limpo) return null
  const n = Number(limpo)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

export function ImovelForm({
  imovel,
  proprietarios,
  corretores,
}: {
  imovel: Property
  proprietarios: { id: string; nome: string; cpf_last4: string }[]
  corretores: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [form, setForm] = useState({
    title: imovel.title,
    operation: imovel.operation,
    property_type: imovel.property_type,
    region: imovel.region,
    city: imovel.city,
    address: imovel.address ?? '',
    description: imovel.description ?? '',
    price_cents: paraCampo(imovel.price_cents),
    rent_price_cents: paraCampo(imovel.rent_price_cents),
    condo_fee_cents: paraCampo(imovel.condo_fee_cents),
    bedrooms: imovel.bedrooms?.toString() ?? '',
    suites: imovel.suites?.toString() ?? '',
    bathrooms: imovel.bathrooms?.toString() ?? '',
    parking_spots: imovel.parking_spots?.toString() ?? '',
    area_m2: imovel.area_m2?.toString() ?? '',
    amenities: (imovel.amenities ?? []).join(', '),
    owner_registration_id: imovel.owner_registration_id ?? '',
    broker_id: imovel.broker_id ?? '',
    status: imovel.status,
  })

  const set = (campo: string, valor: string) => setForm((f) => ({ ...f, [campo]: valor }))

  /* Status de negócio não é editável aqui: mudar 'reservado' para 'disponivel'
     na mão desfaria uma reserva sem passar pelo fluxo de contrato. */
  const statusTravado = !['disponivel', 'inativo'].includes(imovel.status)

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    setSalvo(false)
    setSalvando(true)

    const corpo: Record<string, unknown> = {
      title: form.title,
      operation: form.operation,
      property_type: form.property_type,
      region: form.region,
      city: form.city,
      address: form.address,
      description: form.description,
      price_cents: paraCentavos(form.price_cents),
      rent_price_cents: paraCentavos(form.rent_price_cents),
      condo_fee_cents: paraCentavos(form.condo_fee_cents),
      bedrooms: form.bedrooms || null,
      suites: form.suites || null,
      bathrooms: form.bathrooms || null,
      parking_spots: form.parking_spots || null,
      area_m2: form.area_m2 ? form.area_m2.replace(',', '.') : null,
      amenities: form.amenities.split(',').map((a) => a.trim()).filter(Boolean),
      owner_registration_id: form.owner_registration_id || null,
      broker_id: form.broker_id || null,
    }
    if (!statusTravado) corpo.status = form.status

    const r = await fetch(`/api/admin/properties/${imovel.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    })
    const resposta = await r.json()
    setSalvando(false)

    if (!r.ok) return setErro(resposta.erro ?? 'Não foi possível salvar.')

    setSalvo(true)
    router.refresh()
    setTimeout(() => setSalvo(false), 2500)
  }

  return (
    <form onSubmit={salvar} className="space-y-4 max-w-3xl">
      <Link
        href="/admin/imoveis"
        className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Voltar para os imóveis
      </Link>

      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Identificação</h2>

        <div>
          <label className={rotuloClasse} htmlFor="title">Título</label>
          <input id="title" value={form.title} onChange={(e) => set('title', e.target.value)} className={campoClasse} required />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={rotuloClasse} htmlFor="operation">Operação</label>
            <select id="operation" value={form.operation} onChange={(e) => set('operation', e.target.value)} className={campoClasse}>
              <option value="venda">Venda</option>
              <option value="aluguel">Aluguel</option>
              <option value="ambos">Ambos</option>
            </select>
          </div>
          <div>
            <label className={rotuloClasse} htmlFor="property_type">Tipo</label>
            <select id="property_type" value={form.property_type} onChange={(e) => set('property_type', e.target.value)} className={campoClasse}>
              {TIPOS.map((t) => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={rotuloClasse} htmlFor="status">Status</label>
            <select
              id="status"
              value={form.status}
              disabled={statusTravado}
              onChange={(e) => set('status', e.target.value)}
              className={`${campoClasse} disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              <option value="disponivel">Disponível</option>
              <option value="inativo">Inativo</option>
              {statusTravado && <option value={imovel.status}>{imovel.status}</option>}
            </select>
            {statusTravado && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                Imóvel em negócio — resolva o contrato para liberar o status.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Localização</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={rotuloClasse} htmlFor="region">Região</label>
            <input id="region" value={form.region} onChange={(e) => set('region', e.target.value)} className={campoClasse} required />
          </div>
          <div>
            <label className={rotuloClasse} htmlFor="city">Cidade</label>
            <input id="city" value={form.city} onChange={(e) => set('city', e.target.value)} className={campoClasse} required />
          </div>
        </div>

        <div>
          <label className={rotuloClasse} htmlFor="address">Endereço completo</label>
          <input id="address" value={form.address} onChange={(e) => set('address', e.target.value)} className={campoClasse} />
          {/* O endereço entra no contrato e NÃO aparece na vitrine — a página
              pública diz que ele é informado no agendamento. */}
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
            Usado no contrato. Não aparece na vitrine pública.
          </p>
        </div>
      </section>

      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Valores e configuração</h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={rotuloClasse} htmlFor="price_cents">Preço de venda</label>
            <input id="price_cents" inputMode="decimal" value={form.price_cents} onChange={(e) => set('price_cents', e.target.value)} placeholder="820.000,00" className={campoClasse} />
          </div>
          <div>
            <label className={rotuloClasse} htmlFor="rent_price_cents">Aluguel</label>
            <input id="rent_price_cents" inputMode="decimal" value={form.rent_price_cents} onChange={(e) => set('rent_price_cents', e.target.value)} placeholder="3.200,00" className={campoClasse} />
          </div>
          <div>
            <label className={rotuloClasse} htmlFor="condo_fee_cents">Condomínio</label>
            <input id="condo_fee_cents" inputMode="decimal" value={form.condo_fee_cents} onChange={(e) => set('condo_fee_cents', e.target.value)} placeholder="680,00" className={campoClasse} />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {([
            ['bedrooms', 'Dormitórios'],
            ['suites', 'Suítes'],
            ['bathrooms', 'Banheiros'],
            ['parking_spots', 'Vagas'],
            ['area_m2', 'Área (m²)'],
          ] as const).map(([campo, rotulo]) => (
            <div key={campo}>
              <label className={rotuloClasse} htmlFor={campo}>{rotulo}</label>
              <input
                id={campo}
                inputMode={campo === 'area_m2' ? 'decimal' : 'numeric'}
                value={form[campo]}
                onChange={(e) => set(campo, e.target.value)}
                className={campoClasse}
              />
            </div>
          ))}
        </div>

        <div>
          <label className={rotuloClasse} htmlFor="description">Descrição</label>
          <textarea id="description" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} className={campoClasse} />
        </div>

        <div>
          <label className={rotuloClasse} htmlFor="amenities">Características</label>
          <input id="amenities" value={form.amenities} onChange={(e) => set('amenities', e.target.value)} placeholder="portaria 24h, elevador, perto do metrô" className={campoClasse} />
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Separadas por vírgula.</p>
        </div>
      </section>

      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Responsáveis</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={rotuloClasse} htmlFor="owner">Proprietário</label>
            {/* Busca por nome, não `<select>` nativo: com muitos cadastros a
                lista vira caça visual, e a busca do nativo só casa o começo do
                texto — quem lembra do sobrenome não acha ninguém. */}
            <SelecaoBuscavel
              id="owner"
              opcoes={proprietarios.map((p) => ({
                valor: p.id,
                rotulo: p.nome,
                // CPF sempre mascarado na UI (§6.2).
                detalhe: `***${p.cpf_last4.slice(-2)}`,
              }))}
              valor={form.owner_registration_id}
              aoEscolher={(v) => set('owner_registration_id', v)}
              rotuloVazio="Sem proprietário cadastrado"
              placeholder="Buscar proprietário pelo nome…"
            />
            {!form.owner_registration_id && (
              /* Sem proprietário o contrato de locação sai com o LOCADOR em
                 branco — é exatamente a lacuna que a geração assinala. */
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                Sem proprietário, o contrato sai com o LOCADOR/VENDEDOR em branco.{' '}
                <Link href="/admin/proprietarios" className="underline">Cadastrar um</Link>.
              </p>
            )}
          </div>

          <div>
            <label className={rotuloClasse} htmlFor="broker">Corretor responsável</label>
            <SelecaoBuscavel
              id="broker"
              opcoes={corretores.map((c) => ({ valor: c.id, rotulo: c.name }))}
              valor={form.broker_id}
              aoEscolher={(v) => set('broker_id', v)}
              rotuloVazio="Sem corretor"
              placeholder="Buscar corretor pelo nome…"
            />
            {!form.broker_id && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                Sem corretor, o agente não consegue agendar visita para este imóvel.
              </p>
            )}
          </div>
        </div>
      </section>

      {erro && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-4 py-2.5">
          {erro}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={salvando}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-medium transition-colors"
        >
          {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {salvando ? 'Salvando...' : 'Salvar'}
        </button>

        {salvo && (
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="w-3.5 h-3.5" />
            Salvo
          </span>
        )}
      </div>
    </form>
  )
}
