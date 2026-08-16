'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, Building2, Clock, Plus, Trash2 } from 'lucide-react'
import { dataHora, telefone as fmtTelefone } from '@/lib/utils/format'
import type { Configuracoes } from '@/lib/config/app'
import type { ContatoBloqueado } from '@/lib/channels/blocklist'

function Secao({
  titulo,
  icone: Icone,
  ajuda,
  children,
}: {
  titulo: string
  icone: typeof Building2
  ajuda?: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
      <div>
        <h2 className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
          <Icone className="w-3.5 h-3.5 text-gray-400" />
          {titulo}
        </h2>
        {ajuda && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{ajuda}</p>}
      </div>
      {children}
    </section>
  )
}

function Campo({
  rotulo,
  ajuda,
  children,
}: {
  rotulo: string
  ajuda?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">{rotulo}</label>
      {children}
      {ajuda && <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-0.5">{ajuda}</p>}
    </div>
  )
}

const INPUT =
  'w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30 disabled:opacity-60'

export function ConfiguracoesPainel({
  config,
  bloqueados,
  podeEditar,
}: {
  config: Configuracoes
  bloqueados: ContatoBloqueado[]
  podeEditar: boolean
}) {
  const router = useRouter()
  const [form, setForm] = useState(config)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [novoBloqueio, setNovoBloqueio] = useState('')

  function editar<K extends keyof Configuracoes>(campo: K, v: Configuracoes[K]) {
    setForm((f) => ({ ...f, [campo]: v }))
  }

  const sujo = JSON.stringify(form) !== JSON.stringify(config)

  async function salvar() {
    setErro(null)
    setAviso(null)
    setOcupado(true)

    const r = await fetch('/api/admin/configuracoes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome_fantasia: form.nome_fantasia,
        whatsapp_numero: form.whatsapp_numero ?? '',
        email_contato: form.email_contato ?? '',
        endereco: form.endereco ?? '',
        creci: form.creci ?? '',
        followup_ativo: form.followup_ativo,
        followup_horas: form.followup_horas,
        followup_hora_inicio: Number(form.followup_hora_inicio),
        followup_hora_fim: Number(form.followup_hora_fim),
        followup_max_por_execucao: Number(form.followup_max_por_execucao),
        takeover_horas: Number(form.takeover_horas),
        debounce_segundos: Number(form.debounce_segundos),
      }),
    })
    setOcupado(false)

    if (!r.ok) {
      const corpo = await r.json().catch(() => ({}))
      return setErro(corpo.erro ?? 'Não foi possível salvar.')
    }
    /* A janela de cache é curta mas existe: quem salva e testa em seguida
       precisa saber por que a conversa ainda usou o valor antigo. */
    setAviso('Salvo. Conversas já em andamento podem levar até 1 minuto para pegar os valores novos.')
    router.refresh()
  }

  async function bloquear(e: React.FormEvent) {
    e.preventDefault()
    if (!novoBloqueio.trim()) return
    setErro(null)
    setOcupado(true)

    const r = await fetch('/api/admin/configuracoes/bloqueios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefone: novoBloqueio }),
    })
    const corpo = await r.json().catch(() => ({}))
    setOcupado(false)

    if (!r.ok) return setErro(corpo.erro ?? 'Não foi possível bloquear.')
    setNovoBloqueio('')
    router.refresh()
  }

  async function desbloquear(id: string, nome: string) {
    if (!confirm(`Desbloquear ${nome}? Os agentes voltam a responder este contato.`)) return
    setOcupado(true)
    const r = await fetch(`/api/admin/configuracoes/bloqueios/${id}`, { method: 'DELETE' })
    setOcupado(false)
    if (!r.ok) {
      const corpo = await r.json().catch(() => ({}))
      return setErro(corpo.erro ?? 'Não foi possível desbloquear.')
    }
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {erro && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-4 py-2.5">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/50 rounded-lg px-4 py-2.5">
          {aviso}
        </p>
      )}

      {/* ---- Imobiliária ---- */}
      <Secao
        titulo="A imobiliária"
        icone={Building2}
        ajuda="Aparece na vitrine e nos documentos gerados"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Nome">
            <input
              value={form.nome_fantasia}
              onChange={(e) => editar('nome_fantasia', e.target.value)}
              disabled={!podeEditar}
              className={INPUT}
            />
          </Campo>

          <Campo
            rotulo="WhatsApp do atendimento"
            ajuda="Formato internacional só com dígitos: 5511999998888. É o número do botão na página do imóvel."
          >
            <input
              value={form.whatsapp_numero ?? ''}
              onChange={(e) => editar('whatsapp_numero', e.target.value)}
              disabled={!podeEditar}
              placeholder="5511999998888"
              className={INPUT}
            />
          </Campo>

          <Campo rotulo="E-mail de contato">
            <input
              type="email"
              value={form.email_contato ?? ''}
              onChange={(e) => editar('email_contato', e.target.value)}
              disabled={!podeEditar}
              className={INPUT}
            />
          </Campo>

          <Campo rotulo="CRECI">
            <input
              value={form.creci ?? ''}
              onChange={(e) => editar('creci', e.target.value)}
              disabled={!podeEditar}
              className={INPUT}
            />
          </Campo>

          <div className="sm:col-span-2">
            <Campo rotulo="Endereço">
              <input
                value={form.endereco ?? ''}
                onChange={(e) => editar('endereco', e.target.value)}
                disabled={!podeEditar}
                className={INPUT}
              />
            </Campo>
          </div>
        </div>

        {!form.whatsapp_numero && (
          /* Sem número, o link abre o WhatsApp sem destinatário e a pessoa
             precisa escolher o contato na mão — funciona, e perde a maior
             parte de quem clicou. */
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            Sem o número preenchido, o botão &ldquo;Falar sobre este imóvel&rdquo; na vitrine abre
            o WhatsApp sem destinatário.
          </p>
        )}
      </Secao>

      {/* ---- Atendimento ---- */}
      <Secao
        titulo="Atendimento"
        icone={Clock}
        ajuda="Valores que mudam o comportamento do bot em toda conversa"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo
            rotulo="Agrupar mensagens por (segundos)"
            ajuda="O bot espera este silêncio antes de responder, para juntar a rajada de quem escreve em várias mensagens. 0 responde na hora."
          >
            <input
              type="number"
              min={0}
              max={120}
              value={form.debounce_segundos}
              onChange={(e) => editar('debounce_segundos', Number(e.target.value))}
              disabled={!podeEditar}
              className={`${INPUT} tnum`}
            />
          </Campo>

          <Campo
            rotulo="Bot fica calado por (horas) após alguém assumir"
            ajuda="Depois de um atendente assumir a conversa, o agente só volta se esse tempo passar sem atividade."
          >
            <input
              type="number"
              min={1}
              max={720}
              value={form.takeover_horas}
              onChange={(e) => editar('takeover_horas', Number(e.target.value))}
              disabled={!podeEditar}
              className={`${INPUT} tnum`}
            />
          </Campo>
        </div>
      </Secao>

      {/* ---- Follow-up ---- */}
      <Secao titulo="Follow-up" icone={Clock} ajuda="Reengajamento de quem parou de responder">
        <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={form.followup_ativo}
            onChange={(e) => editar('followup_ativo', e.target.checked)}
            disabled={!podeEditar}
            className="rounded border-gray-300 text-rose-600 focus:ring-rose-500/30"
          />
          Enviar follow-up automático
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <Campo
            rotulo="Silêncio antes de cada tentativa (horas)"
            ajuda="Separado por vírgula. A quantidade de números É o número de tentativas: 24,72 significa duas."
          >
            <input
              value={form.followup_horas.join(', ')}
              onChange={(e) =>
                editar(
                  'followup_horas',
                  e.target.value
                    .split(',')
                    .map((x) => Number(x.trim()))
                    .filter((x) => Number.isFinite(x) && x > 0)
                )
              }
              disabled={!podeEditar || !form.followup_ativo}
              placeholder="24, 72"
              className={`${INPUT} tnum`}
            />
          </Campo>

          <Campo rotulo="Janela (horário de Brasília)">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={23}
                value={form.followup_hora_inicio}
                onChange={(e) => editar('followup_hora_inicio', Number(e.target.value))}
                disabled={!podeEditar || !form.followup_ativo}
                className={`${INPUT} tnum`}
              />
              <span className="text-[11px] text-gray-400">às</span>
              <input
                type="number"
                min={1}
                max={24}
                value={form.followup_hora_fim}
                onChange={(e) => editar('followup_hora_fim', Number(e.target.value))}
                disabled={!podeEditar || !form.followup_ativo}
                className={`${INPUT} tnum`}
              />
            </div>
          </Campo>

          <Campo
            rotulo="Máximo por execução"
            ajuda="Teto por rodada do cron — evita virar disparo em massa."
          >
            <input
              type="number"
              min={1}
              max={200}
              value={form.followup_max_por_execucao}
              onChange={(e) => editar('followup_max_por_execucao', Number(e.target.value))}
              disabled={!podeEditar || !form.followup_ativo}
              className={`${INPUT} tnum`}
            />
          </Campo>
        </div>
      </Secao>

      {podeEditar && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={ocupado || !sujo}
            onClick={salvar}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white"
          >
            Salvar configurações
          </button>
          {sujo && (
            <span className="text-[11px] text-amber-600 dark:text-amber-400">
              alterações não salvas
            </span>
          )}
          {config.atualizado_em && !sujo && (
            <span className="text-[11px] text-gray-400 dark:text-gray-600">
              última alteração {dataHora(config.atualizado_em)}
            </span>
          )}
        </div>
      )}

      {/* ---- Bloqueados ---- */}
      <Secao
        titulo={`Contatos bloqueados (${bloqueados.length})`}
        icone={Ban}
        ajuda="Contato bloqueado não gasta nada: sem transcrição, sem análise de imagem, sem agente e sem resposta. A mensagem dele continua sendo gravada no histórico."
      >
        {podeEditar && (
          <form onSubmit={bloquear} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                Bloquear pelo telefone
              </label>
              <input
                value={novoBloqueio}
                onChange={(e) => setNovoBloqueio(e.target.value)}
                placeholder="5511999998888"
                className={INPUT}
              />
            </div>
            <button
              type="submit"
              disabled={!novoBloqueio.trim() || ocupado}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white"
            >
              <Plus className="w-3 h-3" />
              Bloquear
            </button>
          </form>
        )}

        {bloqueados.length === 0 ? (
          <p className="text-[11px] text-gray-400 dark:text-gray-600">Nenhum contato bloqueado.</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {bloqueados.map((c) => (
              <div key={c.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-gray-800 dark:text-gray-200 truncate">
                    {c.name ?? 'Sem nome'}
                    {c.phone && (
                      <span className="text-gray-400 dark:text-gray-600">
                        {' '}
                        · {fmtTelefone(c.phone)}
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-600">
                    {c.channel_default} · último contato {dataHora(c.last_contact)}
                  </p>
                </div>
                {podeEditar && (
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => desbloquear(c.id, c.name ?? 'este contato')}
                    className="p-1.5 rounded-md text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50 flex-shrink-0"
                    aria-label="Desbloquear"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Secao>
    </div>
  )
}
