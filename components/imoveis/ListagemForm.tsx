'use client'

import { useState } from 'react'
import { Check, ImagePlus, Loader2, X } from 'lucide-react'
import type { RascunhoListagem } from '@/lib/imoveis/listagem'

const campoClasse =
  'w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30'

const rotuloClasse = 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5'

const TIPOS = ['apartamento', 'casa', 'studio', 'cobertura', 'sobrado', 'kitnet', 'terreno', 'comercial']
const MAX_FOTOS = 12

/** Aceita "3.500", "3500,00" ou "R$ 3.500" e devolve centavos. */
function paraCentavos(v: string): number | undefined {
  const limpo = v.replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.')
  if (!limpo) return undefined
  const n = Number(limpo)
  return Number.isFinite(n) ? Math.round(n * 100) : undefined
}

function deCentavos(c?: number): string {
  if (c == null) return ''
  return (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
}

export function ListagemForm({
  token,
  rascunho,
}: {
  token: string
  rascunho: RascunhoListagem
}) {
  const [operacao, setOperacao] = useState(rascunho.operation ?? 'aluguel')
  const [tipo, setTipo] = useState(rascunho.property_type ?? '')
  const [regiao, setRegiao] = useState(rascunho.region ?? '')
  const [endereco, setEndereco] = useState(rascunho.address ?? '')
  const [dorms, setDorms] = useState(rascunho.bedrooms?.toString() ?? '')
  const [banheiros, setBanheiros] = useState(rascunho.bathrooms?.toString() ?? '')
  const [vagas, setVagas] = useState(rascunho.parking_spots?.toString() ?? '')
  const [area, setArea] = useState(rascunho.area_m2?.toString() ?? '')
  const [condominio, setCondominio] = useState(deCentavos(rascunho.condo_fee_cents))
  const [aluguel, setAluguel] = useState(deCentavos(rascunho.rent_price_cents))
  const [venda, setVenda] = useState(deCentavos(rascunho.price_cents))
  const [descricao, setDescricao] = useState(rascunho.description ?? '')
  const [fotos, setFotos] = useState<File[]>([])

  const [enviando, setEnviando] = useState(false)
  const [falha, setFalha] = useState<string | null>(null)
  const [concluido, setConcluido] = useState<{ codigo: string; fotos: number } | null>(null)

  function adicionarFotos(lista: FileList | null) {
    if (!lista) return
    setFalha(null)
    const novas = [...fotos, ...Array.from(lista)]
    if (novas.length > MAX_FOTOS) {
      setFalha(`Envie no máximo ${MAX_FOTOS} fotos.`)
      return
    }
    setFotos(novas)
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setFalha(null)

    if (!tipo) return setFalha('Escolha o tipo do imóvel.')
    if (!regiao.trim()) return setFalha('Informe o bairro ou região.')

    setEnviando(true)

    const dados: RascunhoListagem = {
      operation: operacao,
      property_type: tipo,
      region: regiao.trim(),
      address: endereco.trim() || undefined,
      bedrooms: dorms ? Number(dorms) : undefined,
      bathrooms: banheiros ? Number(banheiros) : undefined,
      parking_spots: vagas ? Number(vagas) : undefined,
      area_m2: area ? Number(area.replace(',', '.')) : undefined,
      condo_fee_cents: paraCentavos(condominio),
      rent_price_cents: operacao !== 'venda' ? paraCentavos(aluguel) : undefined,
      price_cents: operacao !== 'aluguel' ? paraCentavos(venda) : undefined,
      description: descricao.trim() || undefined,
    }

    const corpo = new FormData()
    corpo.set('token', token)
    corpo.set('dados', JSON.stringify(dados))
    for (const f of fotos) corpo.append('fotos', f)

    try {
      const r = await fetch('/api/public/property-listing', { method: 'POST', body: corpo })
      const resposta = await r.json()
      setEnviando(false)

      if (!r.ok) return setFalha(resposta.erro ?? 'Não foi possível enviar.')
      setConcluido({ codigo: resposta.codigo, fotos: resposta.fotos })
    } catch {
      setEnviando(false)
      setFalha('Falha de conexão. Verifique sua internet e tente de novo.')
    }
  }

  if (concluido) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
          <Check className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Imóvel enviado!</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-md mx-auto">
          Ele ficou registrado com o código <strong>{concluido.codigo}</strong>
          {concluido.fotos > 0 && ` e ${concluido.fotos} foto${concluido.fotos > 1 ? 's' : ''}`}. Um
          corretor revisa antes de publicar na vitrine — a gente avisa por WhatsApp quando estiver no ar.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">O imóvel</h2>

        <div>
          <label className={rotuloClasse}>O que você quer fazer</label>
          <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 w-fit">
            {[
              { v: 'aluguel', l: 'Alugar' },
              { v: 'venda', l: 'Vender' },
              { v: 'ambos', l: 'Os dois' },
            ].map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setOperacao(o.v)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  operacao === o.v
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {o.l}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={rotuloClasse} htmlFor="tipo">
              Tipo
            </label>
            <select id="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={campoClasse} required>
              <option value="">Selecione</option>
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={rotuloClasse} htmlFor="regiao">
              Bairro ou região
            </label>
            <input id="regiao" value={regiao} onChange={(e) => setRegiao(e.target.value)} className={campoClasse} required />
          </div>
        </div>

        <div>
          <label className={rotuloClasse} htmlFor="endereco">
            Endereço <span className="text-gray-400">(opcional — não aparece na vitrine)</span>
          </label>
          <input id="endereco" value={endereco} onChange={(e) => setEndereco(e.target.value)} className={campoClasse} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className={rotuloClasse} htmlFor="dorms">
              Dormitórios
            </label>
            <input id="dorms" inputMode="numeric" value={dorms} onChange={(e) => setDorms(e.target.value.replace(/\D/g, ''))} className={campoClasse} />
          </div>
          <div>
            <label className={rotuloClasse} htmlFor="banheiros">
              Banheiros
            </label>
            <input id="banheiros" inputMode="numeric" value={banheiros} onChange={(e) => setBanheiros(e.target.value.replace(/\D/g, ''))} className={campoClasse} />
          </div>
          <div>
            <label className={rotuloClasse} htmlFor="vagas">
              Vagas
            </label>
            <input id="vagas" inputMode="numeric" value={vagas} onChange={(e) => setVagas(e.target.value.replace(/\D/g, ''))} className={campoClasse} />
          </div>
          <div>
            <label className={rotuloClasse} htmlFor="area">
              Área (m²)
            </label>
            <input id="area" inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} className={campoClasse} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {operacao !== 'venda' && (
            <div>
              <label className={rotuloClasse} htmlFor="aluguel">
                Aluguel pretendido
              </label>
              <input id="aluguel" inputMode="decimal" value={aluguel} onChange={(e) => setAluguel(e.target.value)} placeholder="3.500,00" className={campoClasse} />
            </div>
          )}
          {operacao !== 'aluguel' && (
            <div>
              <label className={rotuloClasse} htmlFor="venda">
                Preço de venda
              </label>
              <input id="venda" inputMode="decimal" value={venda} onChange={(e) => setVenda(e.target.value)} placeholder="750.000,00" className={campoClasse} />
            </div>
          )}
          <div>
            <label className={rotuloClasse} htmlFor="condominio">
              Condomínio
            </label>
            <input id="condominio" inputMode="decimal" value={condominio} onChange={(e) => setCondominio(e.target.value)} placeholder="680,00" className={campoClasse} />
          </div>
        </div>

        <div>
          <label className={rotuloClasse} htmlFor="descricao">
            O que o imóvel tem de bom
          </label>
          <textarea
            id="descricao"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={3}
            placeholder="Reformado, sol da manhã, perto do metrô..."
            className={campoClasse}
          />
        </div>
      </section>

      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Fotos</h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 mb-3">
          Até {MAX_FOTOS} fotos, de até 5 MB cada. Imóvel com foto é publicado bem mais rápido.
        </p>

        <label className="flex items-center justify-center gap-2 px-4 py-6 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 cursor-pointer hover:border-rose-400 dark:hover:border-rose-600 transition-colors">
          <ImagePlus className="w-4 h-4 text-gray-400" />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Escolher fotos {fotos.length > 0 && `(${fotos.length} selecionada${fotos.length > 1 ? 's' : ''})`}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => adicionarFotos(e.target.files)}
          />
        </label>

        {fotos.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {fotos.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-1.5"
              >
                <span className="truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => setFotos(fotos.filter((_, j) => j !== i))}
                  className="text-gray-400 hover:text-red-500 flex-shrink-0"
                  aria-label={`Remover ${f.name}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {falha && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-4 py-2.5">
          {falha}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-sm font-medium transition-colors"
      >
        {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
        {enviando ? 'Enviando...' : 'Enviar para análise'}
      </button>

      <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center">
        Um corretor revisa antes de publicar. O imóvel não vai para a vitrine automaticamente.
      </p>
    </form>
  )
}
