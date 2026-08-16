import type { NextConfig } from 'next'

/* O host do Supabase é derivado da env em vez de escrito à mão: o projeto de
   produção tem outro subdomínio, e uma lista fixa faria as fotos sumirem no
   deploy sem erro nenhum no build. */
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined

/* Cabeçalhos de segurança. Sem CSP por enquanto: o tema é aplicado por script
   inline no <head> e o widget roda em página de terceiro — um CSP escrito às
   pressas quebraria os dois em produção sem erro visível no build. Fica como
   pendência documentada.

   `frame-ancestors 'none'` no painel: tela autenticada dentro de iframe de
   outro site é clickjacking. A vitrine pode ser embutida (SAMEORIGIN). */
const CABECALHOS_COMUNS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
]

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: '/:path*', headers: [...CABECALHOS_COMUNS, { key: 'X-Frame-Options', value: 'SAMEORIGIN' }] },
      {
        source: '/(admin|login|definir-senha|esqueci-senha|recuperar)/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
      { source: '/admin', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] },
    ]
  },
  images: {
    /* next/image recusa origem remota que não esteja aqui. As fotos de imóvel
       vivem no bucket público do Supabase (migration 017). */
    remotePatterns: supabaseHost
      ? [{ protocol: 'https', hostname: supabaseHost, pathname: '/storage/v1/object/public/**' }]
      : [],
  },
}

export default nextConfig
