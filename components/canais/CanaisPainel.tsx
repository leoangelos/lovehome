'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Globe, Plug, Plus, Trash2, X } from 'lucide-react'
import { dataHora } from '@/lib/utils/format'
import type { ConfigNaTela, CampoSecreto } from '@/lib/channels/salvar-config'
import type { SiteWidget } from '@/lib/channels/sites'
import type { EnvioCrmLinha } from '@/lib/crm/webhook'

interface Campo {
  chave: string
  rotulo: string
  ajuda?: string
  secreto?: boolean
}

/* Cada canal pede coisas diferentes. Mostrar todos os campos para todos deixaria
   metade em branco e ninguém saberia quais importam. */
const CAMPOS: Record<string, Campo[]> = {
  zapi: [
    { chave: 'phoneId', rotulo: 'Instância (ID)', ajuda: 'No painel do Z-API, em Instâncias' },
    { chave: 'accessToken', rotulo: 'Token da instância', secreto: true },
    { chave: 'clientToken', rotulo: 'Client-Token da conta', secreto: true },
    {
      chave: 'verifyToken',
      rotulo: 'Segredo do webhook',
      ajuda: 'Você inventa (longo e aleatório) e repete no fim da URL do webhook',
      secreto: true,
    },
  ],
  meta: [
    { chave: 'phoneId', rotulo: 'Phone number ID', ajuda: 'WhatsApp > API Setup' },
    { chave: 'businessId', rotulo: 'WhatsApp Business Account ID' },
    { chave: 'accessToken', rotulo: 'Token de acesso', secreto: true },
    { chave: 'appSecret', rotulo: 'App secret', ajuda: 'Assina o corpo do webhook', secreto: true },
    { chave: 'verifyToken', rotulo: 'Verify token', ajuda: 'Você inventa e repete na Meta', secreto: true },
  ],
  widget: [],
  asaas: [
    { chave: 'accessToken', rotulo: 'Chave da API', ajuda: 'Asaas > Integrações > API', secreto: true },
    {
      chave: 'verifyToken',
      rotulo: 'Token de autenticação do webhook',
      ajuda: 'Você inventa e repete no cadastro do webhook no Asaas',
      secreto: true,
    },
  ],
  crm: [
    {
      chave: 'webhookUrl',
      rotulo: 'URL do seu webhook',
      ajuda: 'Endpoint do seu CRM que vai receber os leads (POST JSON)',
    },
    {
      chave: 'verifyToken',
      rotulo: 'Segredo de assinatura',
      ajuda: 'Você inventa. Cada envio leva HMAC-SHA256 do corpo no header X-Lovehome-Assinatura',
      secreto: true,
    },
  ],
}

const ROTULO_CANAL: Record<string, string> = {
  zapi: 'WhatsApp (Z-API)',
  meta: 'WhatsApp (Meta Cloud API)',
  widget: 'Widget do site',
  asaas: 'Cobrança (Asaas)',
  crm: 'CRM (webhook de leads)',
}

export function CanaisPainel({
  configs,
  sites,
  enviosCrm = [],
  urlBase,
  podeEditar,
}: {
  configs: ConfigNaTela[]
  sites: SiteWidget[]
  enviosCrm?: EnvioCrmLinha[]
  urlBase: string
  podeEditar: boolean
}) {
  const router = useRouter()
  const [rascunho, setRascunho] = useState<Record<string, Record<string, string>>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [teste, setTeste] = useState<Record<string, { ok: boolean; mensagem: string; detalhe?: string }>>({})
  const [copiado, setCopiado] = useState<string | null>(null)

  const [novaOrigem, setNovaOrigem] = useState('')
  const [novoNome, setNovoNome] = useState('')

  /* O endereço dos snippets e dos webhooks sai de NEXT_PUBLIC_APP_URL. Em
     desenvolvimento isso é localhost, e um trecho com localhost colado no site
     de produção carrega e não funciona — sem erro visível, o widget só não
     abre. Avisar aqui é mais barato que descobrir depois. */
  const emLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(urlBase)

  function editar(canal: string, campo: string, v: string) {
    setRascunho((r) => ({ ...r, [canal]: { ...r[canal], [campo]: v } }))
  }

  async function copiar(texto: string, id: string) {
    await navigator.clipboard.writeText(texto)
    setCopiado(id)
    setTimeout(() => setCopiado(null), 1500)
  }

  async function salvar(canal: string) {
    setErro(null)
    setAviso(null)
    setOcupado(canal)

    const r = await fetch(`/api/admin/canais/${canal}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rascunho[canal] ?? {}),
    })
    setOcupado(null)

    if (!r.ok) {
      const corpo = await r.json().catch(() => ({}))
      return setErro(corpo.erro ?? 'Não foi possível salvar.')
    }

    setRascunho((x) => {
      const copia = { ...x }
      delete copia[canal]
      return copia
    })
    setAviso('Credenciais salvas. Use "Testar conexão" para conferir antes de contar com elas.')
    router.refresh()
  }

  async function reenviarEnvio(id: string) {
    setErro(null)
    setAviso(null)
    setOcupado(`reenvio-${id}`)
    const r = await fetch(`/api/admin/canais/crm/envios/${id}`, { method: 'POST' })
    const corpo = await r.json().catch(() => ({}))
    setOcupado(null)
    if (!r.ok) return setErro(corpo.erro ?? 'Não foi possível reenviar.')
    setAviso(corpo.enviado ? `Reenviado — o CRM respondeu ${corpo.http_status}.` : `Reenviado, mas falhou de novo: ${corpo.motivo}.`)
    router.refresh()
  }

  async function testar(canal: string) {
    setErro(null)
    setOcupado(canal)
    const r = await fetch(`/api/admin/canais/${canal}`, { method: 'POST' })
    const corpo = await r.json()
    setOcupado(null)
    setTeste((t) => ({ ...t, [canal]: corpo }))
  }

  async function adicionarSite(e: React.FormEvent) {
    e.preventDefault()
    if (!novaOrigem.trim()) return
    setErro(null)
    setOcupado('site')

    const r = await fetch('/api/admin/canais/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origem: novaOrigem, nome: novoNome }),
    })
    const corpo = await r.json()
    setOcupado(null)

    if (!r.ok) return setErro(corpo.erro ?? 'Não foi possível cadastrar.')

    setNovaOrigem('')
    setNovoNome('')
    router.refresh()
  }

  async function removerSite(id: string, origem: string) {
    if (!confirm(`Remover ${origem}? O widget para de funcionar nesse site.`)) return
    setOcupado(id)
    const r = await fetch(`/api/admin/canais/sites/${id}`, { method: 'DELETE' })
    setOcupado(null)
    if (!r.ok) {
      const corpo = await r.json().catch(() => ({}))
      return setErro(corpo.erro ?? 'Não foi possível remover.')
    }
    router.refresh()
  }

  function LinhaCopiavel({ rotulo, valor, id }: { rotulo: string; valor: string; id: string }) {
    return (
      <div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">{rotulo}</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-2.5 py-1.5 text-[11px] rounded-lg bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 break-all">
            {valor}
          </code>
          <button
            type="button"
            onClick={() => copiar(valor, id)}
            className="flex-shrink-0 p-1.5 rounded-md text-gray-400 hover:text-rose-600 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Copiar"
          >
            {copiado === id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {erro && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-4 py-2.5">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 rounded-lg px-4 py-2.5">
          {aviso}
        </p>
      )}

      {emLocalhost && (
        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 rounded-lg px-4 py-2.5">
          <strong>Você está em {urlBase}.</strong> Os endereços abaixo — trecho do widget e URLs
          de webhook — saem de <code>NEXT_PUBLIC_APP_URL</code> e por isso apontam para a sua
          máquina. Ao publicar, troque essa variável pelo domínio final e copie os trechos de
          novo: um script com <code>localhost</code> colado no site de produção carrega e o chat
          simplesmente não abre, sem mensagem de erro.
        </p>
      )}

      {configs.map((c) => {
        const campos = CAMPOS[c.channel] ?? []
        const resultado = teste[c.channel]

        return (
          <section
            key={c.channel}
            className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                  {ROTULO_CANAL[c.channel] ?? c.channel}
                </h2>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                  {c.atualizadoEm ? `Atualizado ${dataHora(c.atualizadoEm)}` : 'Nunca configurado pelo painel'}
                  {c.vindoDoAmbiente.length > 0 &&
                    ` · ${c.vindoDoAmbiente.length} credencial(is) vindo do arquivo .env`}
                </p>
              </div>

              <button
                type="button"
                disabled={ocupado === c.channel}
                onClick={() => testar(c.channel)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                <Plug className="w-3 h-3" />
                Testar conexão
              </button>
            </div>

            {resultado && (
              <p
                className={`text-[11px] rounded-lg px-3 py-2 ${
                  resultado.ok
                    ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                    : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
                }`}
              >
                {resultado.ok ? '✓ ' : '✕ '}
                {resultado.mensagem}
                {resultado.detalhe && (
                  <span className="opacity-60"> ({resultado.detalhe})</span>
                )}
              </p>
            )}

            {campos.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {campos.map((campo) => {
                  const segredo = campo.secreto
                    ? c.segredos[campo.chave as CampoSecreto]
                    : undefined
                  const atual =
                    rascunho[c.channel]?.[campo.chave] ??
                    (campo.secreto
                      ? ''
                      : ((c[campo.chave as 'phoneId' | 'businessId' | 'webhookUrl'] as string) ?? ''))

                  return (
                    <div key={campo.chave}>
                      <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                        {campo.rotulo}
                        {segredo?.configurado && (
                          <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">
                            {/* Só os últimos 4: o valor nunca volta ao navegador. */}
                            {segredo.mascara}
                          </span>
                        )}
                      </label>
                      <input
                        type={campo.secreto ? 'password' : 'text'}
                        value={atual}
                        onChange={(e) => editar(c.channel, campo.chave, e.target.value)}
                        disabled={!podeEditar}
                        autoComplete="off"
                        placeholder={
                          campo.secreto && segredo?.configurado
                            ? 'preenchido — digite para trocar'
                            : ''
                        }
                        className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30 disabled:opacity-60"
                      />
                      {campo.ajuda && (
                        <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-0.5">
                          {campo.ajuda}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* ---- Onde apontar o webhook ---- */}
            {c.channel === 'crm' && (
              <div className="space-y-2">
                <p className="text-[11px] text-gray-400 dark:text-gray-500 rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2">
                  Enviamos um POST assinado para a sua URL em dois momentos: <strong>lead_novo</strong> (início de
                  conversa, com nome e telefone quando existirem) e <strong>lead_cadastro_completo</strong> (formulário
                  preenchido, com nome, e-mail e papéis — <strong>nunca CPF</strong>). Ative a chave ao lado depois de
                  testar; sem segredo cadastrado, nada é enviado.
                </p>

                <div>
                  <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 mb-1.5">
                    Últimos envios
                  </p>
                  {enviosCrm.length === 0 ? (
                    <p className="text-[11px] text-gray-400 dark:text-gray-500">
                      Nenhum envio ainda — eles aparecem aqui com o status que a sua URL respondeu.
                    </p>
                  ) : (
                    <div className="rounded-lg border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                      {enviosCrm.map((e) => (
                        <div key={e.id} className="flex items-center gap-2 px-3 py-2">
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-md tnum flex-shrink-0 ${
                              e.sucesso
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            }`}
                          >
                            {e.http_status ?? 'falha'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-gray-700 dark:text-gray-300 truncate">
                              {e.evento}
                              {e.lead_nome && ` · ${e.lead_nome}`}
                            </p>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate tnum">
                              {dataHora(e.ultima_tentativa_em)}
                              {e.tentativas > 1 && ` · ${e.tentativas} tentativas`}
                              {!e.sucesso && e.erro && ` · ${e.erro}`}
                            </p>
                          </div>
                          {!e.sucesso && podeEditar && (
                            <button
                              type="button"
                              disabled={ocupado === `reenvio-${e.id}`}
                              onClick={() => reenviarEnvio(e.id)}
                              className="text-[11px] px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 flex-shrink-0"
                            >
                              {ocupado === `reenvio-${e.id}` ? 'Reenviando…' : 'Reenviar'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {c.channel === 'zapi' && (
              <div className="space-y-2">
                <LinhaCopiavel
                  rotulo="Cole esta URL no painel do Z-API, em Webhooks > Ao receber"
                  valor={`${urlBase}/api/webhook/zapi?token=SEU_SEGREDO`}
                  id="wh-zapi"
                />
                <p className="text-[10px] text-gray-400 dark:text-gray-600">
                  {/* O Z-API não assina o webhook. O segredo na URL é o que
                      impede qualquer POST de virar mensagem de cliente — e a
                      tela nunca mostra o valor salvo, então quem cola precisa
                      trocar SEU_SEGREDO pelo que digitou acima. */}
                  Troque <code>SEU_SEGREDO</code> pelo valor salvo em &ldquo;Segredo do webhook&rdquo;.
                  Sem ele configurado o webhook <strong>recusa tudo</strong> — é o que impede um
                  desconhecido de falar pelo seu WhatsApp.
                </p>
              </div>
            )}
            {c.channel === 'asaas' && (
              <div className="space-y-2">
                <LinhaCopiavel
                  rotulo="URL do webhook, no painel do Asaas"
                  valor={`${urlBase}/api/webhook/asaas`}
                  id="wh-asaas"
                />
                <p className="text-[10px] text-gray-400 dark:text-gray-600">
                  {/* Sandbox e produção são contas diferentes, com chaves
                      diferentes. Trocar sem perceber move dinheiro de verdade. */}
                  Sandbox ou produção é decidido por <code>ASAAS_BASE_URL</code> no servidor, não
                  aqui — use &ldquo;Testar conexão&rdquo; para saber em qual você está.
                </p>
              </div>
            )}
            {c.channel === 'meta' && (
              <div className="space-y-2">
                <LinhaCopiavel
                  rotulo="Callback URL, no painel da Meta"
                  valor={`${urlBase}/api/webhook/meta`}
                  id="wh-meta"
                />
                <p className="text-[10px] text-gray-400 dark:text-gray-600">
                  {/* Erro clássico: configurar o webhook antes de salvar o verify
                      token, e a Meta reprovar a verificação sem dizer por quê. */}
                  Salve o verify token aqui <strong>antes</strong> de registrar o webhook na Meta —
                  a verificação usa exatamente esse valor.
                </p>
              </div>
            )}

            {podeEditar && campos.length > 0 && (
              <button
                type="button"
                disabled={ocupado === c.channel || !rascunho[c.channel]}
                onClick={() => salvar(c.channel)}
                className="px-3.5 py-2 rounded-lg text-[11px] font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white"
              >
                Salvar credenciais
              </button>
            )}

            {campos.length > 0 && (
              <p className="text-[10px] text-gray-400 dark:text-gray-600">
                Campo em branco mantém a credencial atual. Para apagar, fale com quem administra o
                servidor.
              </p>
            )}
          </section>
        )
      })}

      {/* ---- Sites autorizados ---- */}
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
        <div>
          <h2 className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-gray-400" />
            Sites autorizados a usar o widget
          </h2>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
            A vitrine da LoveHome já funciona sem cadastro. Cadastre aqui apenas sites de terceiros.
          </p>
        </div>

        {podeEditar && (
          <form onSubmit={adicionarSite} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                Endereço do site
              </label>
              <input
                value={novaOrigem}
                onChange={(e) => setNovaOrigem(e.target.value)}
                placeholder="https://imobiliariaparceira.com.br"
                className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
              />
            </div>
            <div className="w-[150px]">
              <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                Apelido
              </label>
              <input
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder="opcional"
                className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
              />
            </div>
            <button
              type="submit"
              disabled={!novaOrigem.trim() || ocupado === 'site'}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white"
            >
              <Plus className="w-3 h-3" />
              Autorizar
            </button>
          </form>
        )}

        {sites.length === 0 ? (
          <p className="text-[11px] text-gray-400 dark:text-gray-600 py-2">
            Nenhum site de terceiro autorizado.
          </p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {sites.map((s) => (
              <div key={s.id} className="py-2.5 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-800 dark:text-gray-200 truncate">
                      {s.name ? `${s.name} — ` : ''}
                      {s.origin}
                    </p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-600">
                      autorizado {dataHora(s.created_at)}
                      {!s.is_active && ' · desativado'}
                    </p>
                  </div>
                  {podeEditar && (
                    <button
                      type="button"
                      disabled={ocupado === s.id}
                      onClick={() => removerSite(s.id, s.origin)}
                      className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 flex-shrink-0"
                      aria-label="Remover"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <LinhaCopiavel
                  rotulo="Cole este trecho no site"
                  valor={`<script src="${urlBase}/widget.js" data-site-id="${s.site_id}" defer></script>`}
                  id={`snippet-${s.id}`}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {!podeEditar && (
        <p className="text-[11px] text-gray-400 dark:text-gray-600 flex items-center gap-1.5">
          <X className="w-3 h-3" />
          Você pode ver os canais, mas não alterá-los.
        </p>
      )}
    </div>
  )
}
