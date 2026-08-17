import { CalendarCheck } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { rotuloHorario } from '@/lib/agenda/fuso'
import type { VisitaLinha } from '@/lib/queries/admin'

/* Ocupação deste imóvel: quem vai, quando e com qual corretor.
 *
 * Renderizado no servidor, então a hora sai por lib/agenda/fuso (São Paulo) e
 * não pelo relógio do processo — o servidor está em UTC.
 *
 * É a resposta a "duas pessoas no mesmo apartamento no mesmo horário com
 * corretores diferentes": o motor já recusa e o banco tem índice único, mas
 * quem cadastra o imóvel precisa VER a agenda dele sem sair da ficha. */

/* `agora` vem de fora: componente puro, o "agora" é da página que renderiza. */
export function VisitasDoImovel({ visitas, agora }: { visitas: VisitaLinha[]; agora: Date }) {
  const proximas = visitas
    .filter((v) => new Date(v.scheduled_at).getTime() >= agora.getTime() && ['agendada', 'confirmada'].includes(v.status))
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
  const passadas = visitas.length - proximas.length

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
            <CalendarCheck className="w-3.5 h-3.5 text-gray-400" />
            Visitas deste imóvel
          </h2>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
            Uma visita por horário, com qualquer corretor — o agente só oferece o que está livre aqui.
          </p>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 tnum flex-shrink-0">
          {proximas.length} próxima{proximas.length === 1 ? '' : 's'}
          {passadas > 0 && ` · ${passadas} anterior${passadas === 1 ? '' : 'es'}`}
        </span>
      </div>

      {proximas.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500">Nenhuma visita marcada daqui pra frente.</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800 -mx-5">
          {proximas.map((v) => (
            <div key={v.id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 tnum flex-shrink-0">
                {rotuloHorario(new Date(v.scheduled_at))}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-800 dark:text-gray-200 truncate">{v.lead ?? 'Contato sem nome'}</p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{v.corretor ?? 'Sem corretor'}</p>
              </div>
              <StatusBadge status={v.status} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
