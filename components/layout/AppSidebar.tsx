'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  BookOpen,
  Bot,
  Building2,
  CalendarDays,
  ClipboardList,
  Columns3,
  CreditCard,
  FileCheck,
  FileSignature,
  FileText,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  Radio,
  Settings,
  ShieldCheck,
  Sparkles,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { pode, type Recurso, type Role } from '@/lib/auth/permissions'
import { useMenuMovel, alternarMenuMovel } from '@/components/layout/menu-movel'

/* Navegacao do painel, agrupada pelas telas da secao 17.1 do PRD.

   Rotas sob /admin, e nao na raiz como no esboco da secao 8 do PRD: la o painel
   e a vitrine publica reivindicam ambos /imoveis, e route group do Next nao cria
   segmento de URL — as duas paginas colidiriam na mesma rota e o build falharia.
   A vitrine fica com a URL limpa por ser a face publica/SEO (PRD 17.3).

   O filtro por papel aqui e CONVENIENCIA, nao seguranca: quem souber a URL
   ainda chega na rota. Quem barra e exigirAcesso() no servidor, em cada pagina.
   Esconder o que a pessoa nao pode usar evita frustracao, so isso.

   `pronto: false` marca tela ainda nao construida: o item aparece (a operacao
   enxerga o mapa completo do produto) mas nao navega para um 404. */

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  recurso: Recurso
  pronto?: boolean
}

interface NavGroup {
  titulo: string
  itens: NavItem[]
}

const GRUPOS: NavGroup[] = [
  {
    titulo: 'Atendimento',
    itens: [
      { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard, recurso: 'dashboard', pronto: true },
      { href: '/admin/painel', label: 'Painel', icon: Columns3, recurso: 'painel' , pronto: true },
      { href: '/admin/conversas', label: 'Conversas', icon: MessageSquare, recurso: 'conversas' , pronto: true },
      { href: '/admin/leads', label: 'Leads', icon: Users, recurso: 'leads', pronto: true },
      { href: '/admin/resumos', label: 'Resumos', icon: FileText, recurso: 'resumos', pronto: true },
    ],
  },
  {
    titulo: 'Imóveis',
    itens: [
      { href: '/admin/imoveis', label: 'Imóveis', icon: Building2, recurso: 'imoveis', pronto: true },
      { href: '/admin/proprietarios', label: 'Proprietários', icon: KeyRound, recurso: 'proprietarios', pronto: true },
      { href: '/admin/visitas', label: 'Visitas', icon: CalendarDays, recurso: 'visitas', pronto: true },
    ],
  },
  {
    titulo: 'Negócios',
    itens: [
      { href: '/admin/contratos', label: 'Contratos', icon: FileSignature, recurso: 'contratos', pronto: true },
      { href: '/admin/pagamentos', label: 'Pagamentos', icon: CreditCard, recurso: 'pagamentos' , pronto: true },
      { href: '/admin/documentos', label: 'Documentos', icon: FileCheck, recurso: 'documentos', pronto: true },
      { href: '/admin/formularios', label: 'Formulários', icon: ClipboardList, recurso: 'formularios', pronto: true },
    ],
  },
  {
    titulo: 'Equipe',
    itens: [
      { href: '/admin/corretores', label: 'Corretores', icon: UserCog, recurso: 'corretores', pronto: true },
      { href: '/admin/copiloto', label: 'Copiloto', icon: Sparkles, recurso: 'copiloto' , pronto: true },
      { href: '/admin/usuarios', label: 'Usuários', icon: ShieldCheck, recurso: 'usuarios', pronto: true },
    ],
  },
  {
    titulo: 'Sistema',
    itens: [
      { href: '/admin/agentes', label: 'Agentes', icon: Bot, recurso: 'agentes' , pronto: true },
      { href: '/admin/uso', label: 'Uso e custo', icon: Activity, recurso: 'uso', pronto: true },
      { href: '/admin/canais', label: 'Canais', icon: Radio, recurso: 'canais' , pronto: true },
      { href: '/admin/materiais', label: 'Materiais', icon: BookOpen, recurso: 'materiais' , pronto: true },
      { href: '/admin/configuracoes', label: 'Configurações', icon: Settings, recurso: 'configuracoes' , pronto: true },
    ],
  },
]

export function AppSidebar({ role }: { role: Role }) {
  const pathname = usePathname()
  const aberto = useMenuMovel()

  const gruposVisiveis = GRUPOS.map((g) => ({
    ...g,
    itens: g.itens.filter((i) => pode(role, i.recurso)),
  })).filter((g) => g.itens.length > 0)

  return (
    <>
      {/* Fundo escuro só no mobile — no desktop a sidebar é parte do layout. */}
      {aberto && (
        <button
          type="button"
          aria-label="Fechar o menu"
          onClick={() => alternarMenuMovel(false)}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      )}

      {/* Fixa a partir de lg; gaveta abaixo disso. Num aparelho de 375px a
          barra de 208px comia mais da metade da tela e o conteúdo ficava
          espremido em 167px. */}
      <aside
        className={`w-52 flex-shrink-0 overflow-y-auto bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 py-4 z-40
          fixed inset-y-0 left-0 top-14 transition-transform duration-200
          lg:static lg:top-0 lg:translate-x-0 ${aberto ? 'translate-x-0' : '-translate-x-full'}`}
      >
      {gruposVisiveis.map((grupo) => (
        <div key={grupo.titulo} className="mb-5 px-3">
          <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600">
            {grupo.titulo}
          </p>

          <div className="space-y-0.5">
            {grupo.itens.map((item) => {
              const Icon = item.icon
              const ativo = pathname === item.href

              if (!item.pronto) {
                return (
                  <span
                    key={item.href}
                    title="Ainda não construída"
                    className="flex items-center gap-2.5 px-2 py-1.5 text-xs font-medium rounded-lg text-gray-300 dark:text-gray-700 cursor-default select-none"
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {item.label}
                  </span>
                )
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  /* Fecha a gaveta ao navegar: no mobile ela cobre o conteúdo,
                     e deixá-la aberta esconderia a tela que acabou de abrir. */
                  onClick={() => alternarMenuMovel(false)}
                  className={`flex items-center gap-2.5 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    ativo
                      ? 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
      </aside>
    </>
  )
}
