'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

/* Como uma mensagem chega a um agente (§12.1).
 *
 * Existe porque a pergunta "qual agente conversa com qual, e eles se repassam?"
 * não tinha resposta em lugar nenhum da interface — e a resposta é
 * contraintuitiva: os agentes NÃO se repassam. Quem troca é o Orquestrador, em
 * código, a cada mensagem. */

const AGENTES = [
  {
    key: 'sdr',
    nome: 'SDR',
    quando: 'Procura imóvel para morar — comprar ou alugar',
    cor: 'bg-blue-500',
  },
  {
    key: 'investidor',
    nome: 'Investidor',
    quando: 'Compra para renda: fala de rentabilidade, não de moradia',
    cor: 'bg-violet-500',
  },
  {
    key: 'proprietario',
    nome: 'Proprietário',
    quando: 'Tem imóvel para ofertar',
    cor: 'bg-amber-500',
  },
  {
    key: 'agendamento',
    nome: 'Agendamento',
    quando: 'Quer marcar, remarcar ou cancelar visita',
    cor: 'bg-emerald-500',
  },
  {
    key: 'closer',
    nome: 'Closer',
    quando: 'Decidiu: reserva, documentação e proposta',
    cor: 'bg-rose-500',
  },
  {
    key: 'suporte',
    nome: 'Suporte',
    quando: 'Já é cliente: boleto, contrato, aviso de saída',
    cor: 'bg-cyan-500',
  },
  {
    key: 'despedida',
    nome: 'Despedida',
    quando: 'Encerrou o assunto — é template, não chama modelo',
    cor: 'bg-gray-400',
  },
]

export function FluxoAgentes() {
  const [aberto, setAberto] = useState(false)

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <button
        onClick={() => setAberto((a) => !a)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        aria-expanded={aberto}
      >
        <div>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Como a mensagem chega até um agente
          </h2>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            Quem decide o agente, quando ele troca, e por que um agente nunca passa para outro
          </p>
        </div>
        {aberto ? (
          <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
      </button>

      {aberto && (
        <div className="px-4 pb-5 pt-1 border-t border-gray-100 dark:border-gray-800 space-y-5">
          {/* ---- O caminho ---- */}
          <div className="overflow-x-auto">
            <div className="flex items-stretch gap-2 min-w-max pt-4 text-[11px]">
              {[
                { titulo: 'Mensagem', sub: 'WhatsApp · site · Meta' },
                { titulo: 'Pipeline', sub: 'dedup · identidade · cadastro' },
                { titulo: 'Takeover?', sub: 'humano no controle cala o bot' },
                { titulo: 'Orquestrador', sub: 'escolhe o agente — toda mensagem' },
              ].map((etapa, i) => (
                <div key={etapa.titulo} className="flex items-center gap-2">
                  <div className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 min-w-[120px]">
                    <p className="font-medium text-gray-700 dark:text-gray-300">{etapa.titulo}</p>
                    <p className="text-gray-400 dark:text-gray-500 mt-0.5">{etapa.sub}</p>
                  </div>
                  {i < 3 && <span className="text-gray-300 dark:text-gray-700">→</span>}
                </div>
              ))}
            </div>
          </div>

          {/* ---- Os agentes ---- */}
          <div>
            <p className="text-[11px] font-medium text-gray-600 dark:text-gray-400 mb-2">
              O Orquestrador escolhe um destes sete:
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {AGENTES.map((a) => (
                <div
                  key={a.key}
                  className="flex items-start gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800"
                >
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${a.cor}`} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{a.nome}</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-snug">
                      {a.quando}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ---- As respostas que faltavam ---- */}
          <div className="space-y-2.5 text-[11px] leading-relaxed">
            <p className="text-gray-600 dark:text-gray-400">
              <strong className="text-gray-800 dark:text-gray-200">
                Um agente pode passar para outro?
              </strong>{' '}
              Não. Nenhum agente chama outro. A troca acontece no Orquestrador, que roda em toda
              mensagem e pode mudar o agente quando o assunto muda — se a pessoa vinha falando com
              o SDR e pergunta do boleto, a próxima mensagem cai no Suporte.
            </p>
            <p className="text-gray-600 dark:text-gray-400">
              <strong className="text-gray-800 dark:text-gray-200">Por que não por repasse?</strong>{' '}
              Um repasse por ferramenta dependeria de o modelo lembrar de chamá-la. Neste projeto,
              ação com consequência para o cliente não depende disso — quem decide é código.
            </p>
            <p className="text-gray-600 dark:text-gray-400">
              <strong className="text-gray-800 dark:text-gray-200">
                O agente lembra do que foi dito com outro?
              </strong>{' '}
              Não. Cada agente tem histórico próprio, por pessoa. Trocar de agente é começar uma
              linha de conversa nova — o histórico do anterior continua guardado e volta se ele
              voltar. O que atravessa canais (site → WhatsApp) é o mesmo histórico, porque é a
              mesma pessoa.
            </p>
            <p className="text-gray-600 dark:text-gray-400">
              <strong className="text-gray-800 dark:text-gray-200">
                A única saída que o agente controla
              </strong>{' '}
              é <code className="text-gray-500">escalate_to_human</code>: marca a conversa como
              escalada e devolve o assunto para uma pessoa. Ele não escolhe para qual agente ir.
            </p>
            <p className="text-gray-600 dark:text-gray-400">
              <strong className="text-gray-800 dark:text-gray-200">
                Trocar o modelo aqui vale para qual?
              </strong>{' '}
              Só para o agente editado. O Orquestrador é um item da lista como qualquer outro —
              trocar o dele muda como as mensagens são classificadas, não como são respondidas.
            </p>
          </div>

          <p className="text-[11px] text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-800 pt-3">
            Para ver a decisão de uma resposta específica — qual agente, por quê, com quais
            ferramentas — abra o trace embaixo da mensagem em Conversas.
          </p>
        </div>
      )}
    </section>
  )
}
