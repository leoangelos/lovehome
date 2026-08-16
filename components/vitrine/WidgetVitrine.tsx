'use client'

import { useEffect } from 'react'
import Script from 'next/script'

/* Carrega o widget na vitrine e o DESLIGA quando a pessoa sai dela.
 *
 * O `widget.js` é o mesmo arquivo que um site de terceiro embutiria, e ele se
 * pendura no <body>. Aqui a vitrine é uma SPA: ir de /imoveis para /admin não
 * recarrega a página, o layout público desmonta, mas o que o script colocou no
 * <body> continuava lá — o balão do widget aparecia por cima do Copiloto do
 * painel. Este componente é o dono do ciclo de vida: monta ao entrar na
 * vitrine, destrói ao sair, remonta ao voltar.
 *
 * `next/script` não re-executa um src já carregado, então "voltar" precisa
 * chamar `montar()` da API que o script deixou em `window.LoveHomeWidget`. */

declare global {
  interface Window {
    LoveHomeWidget?: { montar: () => void; destruir: () => void }
    __lovehomeWidgetPagina?: boolean
  }
}

export function WidgetVitrine() {
  useEffect(() => {
    /* A flag cobre a corrida: se o script terminar de carregar DEPOIS de a
       pessoa ter saído da vitrine, ele lê `false` e não monta. */
    window.__lovehomeWidgetPagina = true
    window.LoveHomeWidget?.montar()

    return () => {
      window.__lovehomeWidgetPagina = false
      window.LoveHomeWidget?.destruir()
    }
  }, [])

  /* Sem data-site-id: a vitrine roda na própria origem, aceita por ser a mesma
     do servidor. Site de terceiro precisa de linha em `widget_sites` e do
     atributo.

     `afterInteractive`, não `lazyOnload`: o botão de chat é parte da página,
     não enfeite — com lazyOnload ele esperava o navegador ficar ocioso e, em
     aba de fundo, não aparecia nunca. */
  return <Script src="/widget.js" strategy="afterInteractive" />
}
