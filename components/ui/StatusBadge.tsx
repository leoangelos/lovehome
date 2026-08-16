/* Pilulas de status. As chaves sao exatamente os valores dos CHECK constraints
   do schema (PRD 10) — um status novo no banco sem entrada aqui cai no estilo
   neutro em vez de quebrar a tela.

   A escala de cor e semantica, no mesmo espirito da COR_FAIXA da referencia:
   verde = ativo/ok, ambar = aguardando acao humana, azul = em andamento,
   vermelho = negativo, cinza = encerrado/inerte. */

const ESTILOS: Record<string, string> = {
  // properties.status
  em_analise: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  disponivel: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  reservado: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  vendido: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  alugado: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  inativo: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',

  // deals.status
  em_aprovacao: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  aprovado: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  ativo: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  encerramento_solicitado: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  encerrado: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  concluido: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  cancelado: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',

  // lease_payments.status
  pendente: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  pago: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  atrasado: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',

  // contacts.funnel_stage
  novo: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  qualificando: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  qualificado: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  visita_agendada: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  em_negociacao: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  convertido: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  perdido: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',

  // rag_documents.status
  processando: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  indexado: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  erro: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',

  // form_submissions.status ('pendente' ja esta acima)
  preenchido: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  expirado: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

const NEUTRO = 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'

/* Rotulos de exibicao. Existem separados porque os valores do banco nao tem
   acento — derivar o texto do enum imprimiria "Em analise" e "Disponivel" na
   tela de um produto em portugues. */
/* A tabela mora em lib/ui/rotulos.ts — leaf sem dependência — porque também é
   lida por módulo de servidor (as tools do Copiloto). Reexportada aqui para
   não quebrar quem já importava daqui. */
export { ROTULOS_STATUS } from '@/lib/ui/rotulos'
import { ROTULOS_STATUS as TABELA } from '@/lib/ui/rotulos'

/** Fallback para status novo no banco ainda sem rotulo: 'visita_agendada' → 'Visita agendada' */
function rotular(status: string): string {
  const t = status.replace(/_/g, ' ')
  return TABELA[status] ?? t.charAt(0).toUpperCase() + t.slice(1)
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap ${
        ESTILOS[status] ?? NEUTRO
      }`}
    >
      {label ?? rotular(status)}
    </span>
  )
}
