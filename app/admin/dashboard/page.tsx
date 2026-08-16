import type { Metadata } from 'next'
import { AlertTriangle, CalendarCheck, FileClock, Users } from 'lucide-react'
import { StatCard } from '@/components/ui/StatCard'
import { ChartCard } from '@/components/ui/ChartCard'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { BarList } from '@/components/ui/BarList'
import { brl, dataHora, num } from '@/lib/utils/format'
import { getDashboardMetrics } from '@/lib/queries/dashboard'
import { exigirAcesso } from '@/lib/auth/session'

export const metadata: Metadata = {
  title: 'Dashboard — LoveHome',
}

/* Painel operacional: precisa refletir o banco a cada carga, nao uma versao
   gerada no build. */
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  await exigirAcesso('dashboard')
  const m = await getDashboardMetrics()

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Funil, visitas, aprovações e cobrança
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Leads ativos"
          valor={num(m.leadsAtivos)}
          sub="Fora de convertido e perdido"
          icon={Users}
        />
        <StatCard
          label="Visitas na semana"
          valor={num(m.visitasSemana.length)}
          sub="Agendadas e confirmadas"
          icon={CalendarCheck}
          iconBg="bg-violet-100 dark:bg-violet-900/30"
          iconColor="text-violet-600 dark:text-violet-400"
        />
        <StatCard
          label="Aguardando aprovação"
          valor={num(m.filaAprovacao.length)}
          sub={`+ ${m.documentosPendentes} documentos em revisão`}
          destaque="Gargalo trava contrato"
          destaqueClasse="text-amber-600 dark:text-amber-400"
          icon={FileClock}
          iconBg="bg-amber-100 dark:bg-amber-900/30"
          iconColor="text-amber-600 dark:text-amber-400"
        />
        <StatCard
          label="Cobranças em atraso"
          valor={num(m.cobrancas.atrasadas)}
          sub={`${brl(m.cobrancas.valorAtrasadoCents)} em aberto`}
          destaque={`${brl(m.cobrancas.recebidoMesCents)} recebidos no mês`}
          destaqueClasse="text-emerald-600 dark:text-emerald-400"
          icon={AlertTriangle}
          iconBg="bg-red-100 dark:bg-red-900/30"
          iconColor="text-red-600 dark:text-red-400"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard titulo="Funil de leads" subtitulo="Contatos por estágio">
          <BarList
            itens={m.funil.map((f) => ({
              label: f.label,
              total: f.total,
              cor: f.stage === 'perdido' ? 'bg-gray-400 dark:bg-gray-600' : 'bg-rose-500',
            }))}
          />
        </ChartCard>

        <ChartCard titulo="Distribuição por intenção" subtitulo="O que o lead veio buscar">
          <BarList
            itens={m.porIntencao.map((i) => ({
              label: i.label,
              total: i.total,
              cor:
                i.intent === 'disponibilizar_imovel'
                  ? 'bg-violet-500'
                  : i.intent === 'investimento'
                    ? 'bg-amber-500'
                    : 'bg-blue-500',
            }))}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard titulo="Visitas da semana" subtitulo="Próximos compromissos dos corretores">
          <div className="divide-y divide-gray-100 dark:divide-gray-800 -mx-1">
            {m.visitasSemana.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 py-2.5 px-1">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                    {v.lead}
                  </p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                    {v.imovel} · {v.corretor}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 tnum">
                    {dataHora(v.quando)}
                  </span>
                  <StatusBadge status={v.status} />
                </div>
              </div>
            ))}

            {m.visitasSemana.length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 py-6 text-center">
                Nenhuma visita agendada para os próximos 7 dias.
              </p>
            )}
          </div>
        </ChartCard>

        <ChartCard
          titulo="Fila de aprovação"
          subtitulo="Nenhum contrato é gerado sem passar por aqui"
        >
          <div className="divide-y divide-gray-100 dark:divide-gray-800 -mx-1">
            {m.filaAprovacao.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 py-2.5 px-1">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200">{a.label}</p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                    {a.descricao}
                  </p>
                </div>
                <span className="text-[11px] text-gray-500 dark:text-gray-400 tnum flex-shrink-0">
                  desde {dataHora(a.desde)}
                </span>
              </div>
            ))}

            {m.filaAprovacao.length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 py-6 text-center">
                Nada aguardando aprovação.
              </p>
            )}
          </div>
        </ChartCard>
      </div>
    </div>
  )
}
