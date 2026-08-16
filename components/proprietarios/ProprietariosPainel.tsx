'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { KeyRound, Loader2, UserPlus } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { cpfMascarado } from '@/lib/utils/format'
import { cpfValido } from '@/lib/registrations/cpf-formato'
import type { ProprietarioLinha } from '@/lib/queries/proprietarios'

const campoClasse =
  'w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30'
const rotuloClasse = 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5'

const ROTULO_PAPEL: Record<string, string> = {
  interessado: 'também é interessado',
  inquilino_ativo: 'também é inquilino',
}

function mascararCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

export function ProprietariosPainel({
  proprietarios,
  podeCadastrar,
}: {
  proprietarios: ProprietarioLinha[]
  podeCadastrar: boolean
}) {
  const router = useRouter()
  const [abrindo, setAbrindo] = useState(false)
  const [cpf, setCpf] = useState('')
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [rua, setRua] = useState('')
  const [numero, setNumero] = useState('')
  const [bairro, setBairro] = useState('')
  const [cidade, setCidade] = useState('São Paulo')
  const [uf, setUf] = useState('SP')
  const [cep, setCep] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<string | null>(null)

  async function cadastrar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    setSucesso(null)

    if (!cpfValido(cpf)) return setErro('CPF inválido. Confira os números.')
    if (!nome.trim().includes(' ')) return setErro('Informe o nome completo.')

    setSalvando(true)
    const r = await fetch('/api/admin/proprietarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cpf: cpf.replace(/\D/g, ''),
        full_name: nome,
        email,
        address: {
          street: rua,
          number: numero,
          neighborhood: bairro,
          city: cidade,
          state: uf,
          zip: cep.replace(/\D/g, ''),
        },
      }),
    })
    const corpo = await r.json()
    setSalvando(false)

    if (!r.ok) return setErro(corpo.erro ?? 'Não foi possível cadastrar.')

    setSucesso(
      corpo.ja_existia
        ? `${corpo.nome} já tinha cadastro e agora também é proprietário.`
        : `${corpo.nome} cadastrado. Já pode ser vinculado a um imóvel.`
    )
    setCpf('')
    setNome('')
    setEmail('')
    setRua('')
    setNumero('')
    setBairro('')
    setCep('')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {podeCadastrar && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {proprietarios.length} proprietário{proprietarios.length === 1 ? '' : 's'} ·{' '}
            {proprietarios.reduce((n, p) => n + p.imoveis.length, 0)} imóvel(is) vinculado(s)
          </p>
          <button
            type="button"
            onClick={() => setAbrindo((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Cadastrar proprietário
          </button>
        </div>
      )}

      {abrindo && (
        <form
          onSubmit={cadastrar}
          className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4"
        >
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Para quem já era cliente da imobiliária antes do WhatsApp. O CPF é gravado
            criptografado e só aparece inteiro no contrato.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={rotuloClasse} htmlFor="cpf">CPF</label>
              <input id="cpf" inputMode="numeric" value={cpf} onChange={(e) => setCpf(mascararCpf(e.target.value))} placeholder="000.000.000-00" className={campoClasse} required />
            </div>
            <div className="sm:col-span-2">
              <label className={rotuloClasse} htmlFor="nome">Nome completo</label>
              <input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} className={campoClasse} required />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={rotuloClasse} htmlFor="email">E-mail</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={campoClasse} />
            </div>
            <div>
              <label className={rotuloClasse} htmlFor="cep">CEP</label>
              <input id="cep" inputMode="numeric" value={cep} onChange={(e) => setCep(e.target.value)} className={campoClasse} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="sm:col-span-2">
              <label className={rotuloClasse} htmlFor="rua">Rua</label>
              <input id="rua" value={rua} onChange={(e) => setRua(e.target.value)} className={campoClasse} />
            </div>
            <div>
              <label className={rotuloClasse} htmlFor="numero">Número</label>
              <input id="numero" value={numero} onChange={(e) => setNumero(e.target.value)} className={campoClasse} />
            </div>
            <div>
              <label className={rotuloClasse} htmlFor="bairro">Bairro</label>
              <input id="bairro" value={bairro} onChange={(e) => setBairro(e.target.value)} className={campoClasse} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="sm:col-span-3">
              <label className={rotuloClasse} htmlFor="cidade">Cidade</label>
              <input id="cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} className={campoClasse} />
            </div>
            <div>
              <label className={rotuloClasse} htmlFor="uf">UF</label>
              <input id="uf" value={uf} maxLength={2} onChange={(e) => setUf(e.target.value.toUpperCase())} className={campoClasse} />
            </div>
          </div>

          {erro && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-3 py-2">
              {erro}
            </p>
          )}

          <button
            type="submit"
            disabled={salvando}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-medium"
          >
            {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {salvando ? 'Salvando...' : 'Cadastrar'}
          </button>
        </form>
      )}

      {sucesso && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/50 rounded-lg px-4 py-2.5">
          {sucesso}
        </p>
      )}

      {proprietarios.length === 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <KeyRound className="w-8 h-8 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nenhum proprietário cadastrado. Eles chegam pelo agente Proprietário no WhatsApp,
            ou podem ser cadastrados aqui.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {proprietarios.map((p) => (
          <div
            key={p.id}
            className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5"
          >
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{p.full_name}</h2>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 tnum">
              {/* CPF nunca inteiro na tela (§6.2) */}
              {cpfMascarado(p.cpf_last4)}
              {p.email && ` · ${p.email}`}
            </p>

            {p.outros_papeis.length > 0 && (
              <div className="flex gap-1 mt-2">
                {p.outros_papeis.map((papel) => (
                  <span
                    key={papel}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                  >
                    {ROTULO_PAPEL[papel] ?? papel}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
              <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 mb-1.5">
                Imóveis
              </p>
              {p.imoveis.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Nenhum imóvel vinculado ainda.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {p.imoveis.map((i) => (
                    <li key={i.reference_code} className="flex items-center justify-between gap-2">
                      <Link
                        href={`/admin/imoveis/${i.reference_code}`}
                        className="text-xs text-gray-700 dark:text-gray-300 hover:text-rose-600 dark:hover:text-rose-400 truncate"
                      >
                        <span className="tnum text-gray-400 dark:text-gray-500">
                          {i.reference_code}
                        </span>{' '}
                        {i.title}
                      </Link>
                      <StatusBadge status={i.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
