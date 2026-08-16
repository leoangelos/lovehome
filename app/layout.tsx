import type { Metadata } from 'next'
import Script from 'next/script'
import { DetectorRecuperacao } from '@/components/auth/DetectorRecuperacao'
import './globals.css'

export const metadata: Metadata = {
  title: 'LoveHome — Atendimento e gestão imobiliária',
  description: 'Plataforma de atendimento e gestão imobiliária com IA generativa',
}

/* Aplica o tema antes da primeira pintura. Sem isso, o painel abre claro e
   pisca para escuro depois da hidratação — por isso é inline e beforeInteractive,
   não um efeito.

   Vai por next/script, e não por uma tag <script> escrita direto no JSX: o React
   19 não executa scripts renderizados no cliente e emite erro no console quando
   encontra um. O next/script injeta fora do fluxo de renderização. */
const THEME_SCRIPT = `
try {
  var t = localStorage.getItem('lovehome_theme')
  if (t === 'dark') document.documentElement.classList.add('dark')
} catch (e) {}
`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <Script
          id="lovehome-theme"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
        />
        <DetectorRecuperacao />
        {children}
      </body>
    </html>
  )
}
