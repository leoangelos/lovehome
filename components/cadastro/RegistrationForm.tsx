'use client'

import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { cpfValido } from '@/lib/registrations/cpf-formato'
import { validarRespostas, type CampoFormulario } from '@/lib/registrations/campos-formato'
import { CamposExtras } from '@/components/cadastro/CamposExtras'
import type { ContactRole } from '@/lib/types/domain'

/* Formulario de cadastro (PRD 6.5).

   Os campos do cadastro em si sao fixos de proposito: CPF, nome, e-mail,
   endereco e papel definem `registration_status = 'completo'` no gate da secao
   6.3, e deixar a tela de admin desliga-los faria o portao dizer "completo"
   sobre um cadastro que nao sustenta contrato. As perguntas configuraveis
   (`campos`) vem DEPOIS, e sao adicionais.

   A validacao daqui e conveniencia para o usuario ver o erro antes de enviar.
   A que vale roda no servidor (lib/registrations/form.ts): o navegador e do
   cliente, e nada que chega dele pode ser tratado como verificado. */

const PAPEIS: { valor: ContactRole; titulo: string; descricao: string }[] = [
  {
    valor: 'interessado',
    titulo: 'Procurar um imóvel',
    descricao: 'Quero comprar, alugar ou investir',
  },
  {
    valor: 'proprietario',
    titulo: 'Disponibilizar um imóvel',
    descricao: 'Tenho um imóvel para alugar ou vender',
  },
]

const UFS = ['SP', 'RJ', 'MG', 'ES', 'PR', 'SC', 'RS', 'BA', 'GO', 'DF', 'PE', 'CE', 'Outro']

function mascararCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

function mascararCep(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 8)
  return d.replace(/(\d{5})(\d)/, '$1-$2')
}

const campoClasse =
  'w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30'

const rotuloClasse = 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5'

export function RegistrationForm({
  token,
  nomeSugerido,
  campos = [],
}: {
  token: string
  nomeSugerido: string | null
  campos?: CampoFormulario[]
}) {
  const [cpf, setCpf] = useState('')
  const [nome, setNome] = useState(nomeSugerido ?? '')
  const [email, setEmail] = useState('')
  const [nascimento, setNascimento] = useState('')
  const [cep, setCep] = useState('')
  const [rua, setRua] = useState('')
  const [numero, setNumero] = useState('')
  const [complemento, setComplemento] = useState('')
  const [bairro, setBairro] = useState('')
  const [cidade, setCidade] = useState('São Paulo')
  const [uf, setUf] = useState('SP')
  const [papeis, setPapeis] = useState<ContactRole[]>([])
  const [extras, setExtras] = useState<Record<string, unknown>>({})

  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [concluido, setConcluido] = useState<{ revisao: boolean; mensagem?: string } | null>(null)

  function alternarPapel(p: ContactRole) {
    setPapeis((atual) => (atual.includes(p) ? atual.filter((x) => x !== p) : [...atual, p]))
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)

    if (!cpfValido(cpf)) return setErro('CPF inválido. Confira os números.')
    if (!nome.trim().includes(' ')) return setErro('Informe o nome completo.')
    if (papeis.length === 0) return setErro('Escolha ao menos uma opção do que você quer fazer.')

    const { erros: errosExtra } = validarRespostas(campos, extras, papeis)
    if (errosExtra.length) return setErro(errosExtra[0].mensagem)

    setEnviando(true)
    try {
      const resposta = await fetch('/api/public/registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          dados: {
            cpf: cpf.replace(/\D/g, ''),
            full_name: nome.trim(),
            email: email.trim(),
            birth_date: nascimento || undefined,
            address: {
              street: rua.trim(),
              number: numero.trim(),
              complement: complemento.trim() || undefined,
              neighborhood: bairro.trim(),
              city: cidade.trim(),
              state: uf,
              zip: cep.replace(/\D/g, ''),
            },
            roles: papeis,
            /* O servidor revalida e descarta o que nao corresponde a campo
               ativo e visivel — isto aqui e conveniencia, nao garantia. */
            extra: extras,
          },
        }),
      })

      const corpo = await resposta.json()

      if (!resposta.ok) {
        setErro(corpo.erro ?? 'Não foi possível enviar. Tente novamente.')
        return
      }

      setConcluido({ revisao: Boolean(corpo.revisao), mensagem: corpo.mensagem })
    } catch {
      setErro('Falha de conexão. Verifique sua internet e tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  if (concluido) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
          <Check className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {concluido.revisao ? 'Recebemos seus dados' : 'Cadastro concluído!'}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-md mx-auto">
          {concluido.mensagem ??
            'Pode voltar para a conversa no WhatsApp — de lá a gente continua de onde parou.'}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Seus dados</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={rotuloClasse} htmlFor="cpf">
              CPF
            </label>
            <input
              id="cpf"
              inputMode="numeric"
              autoComplete="off"
              value={cpf}
              onChange={(e) => setCpf(mascararCpf(e.target.value))}
              placeholder="000.000.000-00"
              className={campoClasse}
              required
            />
          </div>

          <div>
            <label className={rotuloClasse} htmlFor="nascimento">
              Data de nascimento <span className="text-gray-400">(opcional)</span>
            </label>
            <input
              id="nascimento"
              type="date"
              value={nascimento}
              onChange={(e) => setNascimento(e.target.value)}
              className={campoClasse}
            />
          </div>
        </div>

        <div>
          <label className={rotuloClasse} htmlFor="nome">
            Nome completo
          </label>
          <input
            id="nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Como está no documento"
            className={campoClasse}
            required
          />
        </div>

        <div>
          <label className={rotuloClasse} htmlFor="email">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@email.com"
            className={campoClasse}
            required
          />
        </div>
      </section>

      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Endereço</h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={rotuloClasse} htmlFor="cep">
              CEP
            </label>
            <input
              id="cep"
              inputMode="numeric"
              value={cep}
              onChange={(e) => setCep(mascararCep(e.target.value))}
              placeholder="00000-000"
              className={campoClasse}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className={rotuloClasse} htmlFor="rua">
              Rua
            </label>
            <input
              id="rua"
              value={rua}
              onChange={(e) => setRua(e.target.value)}
              className={campoClasse}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={rotuloClasse} htmlFor="numero">
              Número
            </label>
            <input
              id="numero"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              className={campoClasse}
              required
            />
          </div>
          <div>
            <label className={rotuloClasse} htmlFor="complemento">
              Complemento <span className="text-gray-400">(opcional)</span>
            </label>
            <input
              id="complemento"
              value={complemento}
              onChange={(e) => setComplemento(e.target.value)}
              placeholder="Apto, bloco"
              className={campoClasse}
            />
          </div>
          <div>
            <label className={rotuloClasse} htmlFor="bairro">
              Bairro
            </label>
            <input
              id="bairro"
              value={bairro}
              onChange={(e) => setBairro(e.target.value)}
              className={campoClasse}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className={rotuloClasse} htmlFor="cidade">
              Cidade
            </label>
            <input
              id="cidade"
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
              className={campoClasse}
              required
            />
          </div>
          <div>
            <label className={rotuloClasse} htmlFor="uf">
              Estado
            </label>
            <select id="uf" value={uf} onChange={(e) => setUf(e.target.value)} className={campoClasse}>
              {UFS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          O que você quer fazer?
        </h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 mb-3">
          Pode marcar as duas — uma coisa não exclui a outra.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PAPEIS.map((p) => {
            const marcado = papeis.includes(p.valor)
            return (
              <button
                key={p.valor}
                type="button"
                onClick={() => alternarPapel(p.valor)}
                aria-pressed={marcado}
                className={`text-left p-4 rounded-lg border transition-colors ${
                  marcado
                    ? 'border-rose-400 dark:border-rose-600 bg-rose-50 dark:bg-rose-900/20'
                    : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border ${
                      marcado
                        ? 'bg-rose-500 border-rose-500'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    {marcado && <Check className="w-3 h-3 text-white" />}
                  </span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {p.titulo}
                  </span>
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">
                  {p.descricao}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <CamposExtras
        campos={campos}
        papeisMarcados={papeis}
        valores={extras}
        aoMudar={(chave, valor) => setExtras((a) => ({ ...a, [chave]: valor }))}
      />

      {erro && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-4 py-2.5">
          {erro}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-sm font-medium transition-colors"
      >
        {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
        {enviando ? 'Enviando...' : 'Concluir cadastro'}
      </button>

      <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center">
        Seus dados são usados apenas para o atendimento e para os documentos do negócio.
        O CPF é armazenado criptografado.
      </p>
    </form>
  )
}
