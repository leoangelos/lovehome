/* ==========================================================================
   Widget de atendimento do LoveHome.

   Uso no site do cliente:
     <script src="https://SEU-DOMINIO/widget.js"
             data-site-id="imobiliaria-x"
             defer></script>

   Sem dependência e sem build: este arquivo é servido como está, e roda em
   página de terceiro. Duas consequências que moldam o código todo:

   1. ESTILO VAI EM SHADOW DOM. O CSS do site anfitrião não pode vazar para
      dentro do widget nem o contrário. Sem isolamento, um `* { box-sizing }`
      ou um reset agressivo do site quebra o layout — e o inverso é pior, porque
      quebra o site de outra pessoa.
   2. NADA DE VARIÁVEL GLOBAL. Tudo dentro de uma IIFE; o único símbolo exposto
      é window.LoveHomeWidget, para o site poder abrir o chat de um botão dele.
   ========================================================================== */
;(function () {
  'use strict'

  if (window.LoveHomeWidget) return // já carregado

  var script = document.currentScript || (function () {
    var todos = document.getElementsByTagName('script')
    return todos[todos.length - 1]
  })()

  var SITE_ID = script.getAttribute('data-site-id') || null
  /* A base da API sai da URL do próprio script: o widget é servido pelo mesmo
     domínio que atende as rotas, então derivar evita mais um atributo para
     configurar errado. */
  var API = script.getAttribute('data-api') || new URL(script.src).origin
  var TITULO = script.getAttribute('data-titulo') || 'LoveHome'
  var SUBTITULO = script.getAttribute('data-subtitulo') || 'Respondemos na hora'

  var CHAVE_SESSAO = 'lovehome:widget:sessao'
  var CHAVE_IDENTIDADE = 'lovehome:widget:identidade'
  var INTERVALO_POLL = 15000

  var sessionToken = null
  /* Quem já se identificou não preenche de novo, nem depois de fechar a aba. A
     fonte de verdade é o servidor (a sessão tem contact_id); isto aqui só evita
     mostrar o formulário para quem já passou por ele. */
  var identificado = false
  var primeiroNome = null
  var aberto = false
  var enviando = false
  var timerPoll = null

  // ---------------------------------------------------------------- estilo
  var CSS = [
    ':host { all: initial; }',
    '* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
    '.botao { position: fixed; right: 20px; bottom: 20px; width: 56px; height: 56px; border-radius: 28px; border: 0; cursor: pointer; background: #e11d48; color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.18); display: flex; align-items: center; justify-content: center; z-index: 2147483000; }',
    '.botao:hover { background: #be123c; }',
    '.botao svg { width: 24px; height: 24px; }',
    '.painel { position: fixed; right: 20px; bottom: 88px; width: 360px; max-width: calc(100vw - 40px); height: 520px; max-height: calc(100vh - 120px); background: #fff; border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.18); display: none; flex-direction: column; overflow: hidden; z-index: 2147483000; }',
    '.painel.aberto { display: flex; }',
    '.cabecalho { background: #e11d48; color: #fff; padding: 14px 16px; flex-shrink: 0; }',
    '.cabecalho h3 { margin: 0; font-size: 14px; font-weight: 600; }',
    '.cabecalho p { margin: 2px 0 0; font-size: 11px; opacity: .85; }',
    '.fechar { position: absolute; right: 12px; top: 12px; background: transparent; border: 0; color: #fff; cursor: pointer; font-size: 18px; line-height: 1; padding: 4px; }',
    '.conversa { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; background: #f9fafb; display: flex; flex-direction: column; gap: 8px; }',
    '.balao { max-width: 82%; padding: 8px 12px; border-radius: 14px; font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }',
    '.deles { align-self: flex-start; background: #fff; color: #374151; border: 1px solid #e5e7eb; border-bottom-left-radius: 4px; }',
    '.meu { align-self: flex-end; background: #e11d48; color: #fff; border-bottom-right-radius: 4px; }',
    '.aviso { align-self: center; font-size: 11px; color: #9ca3af; text-align: center; padding: 0 12px; }',
    '.pensando { align-self: flex-start; display: flex; gap: 4px; padding: 10px 12px; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; }',
    '.pensando span { width: 6px; height: 6px; border-radius: 3px; background: #d1d5db; animation: pisca 1.2s infinite; }',
    '.pensando span:nth-child(2) { animation-delay: .2s; }',
    '.pensando span:nth-child(3) { animation-delay: .4s; }',
    '@keyframes pisca { 0%, 60%, 100% { opacity: .3 } 30% { opacity: 1 } }',
    '.formulario { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 10px; }',
    '.formulario p.intro { margin: 0 0 2px; font-size: 13px; color: #4b5563; line-height: 1.45; }',
    '.formulario label { display: block; font-size: 11px; font-weight: 600; color: #374151; margin-bottom: 3px; }',
    '.formulario input { width: 100%; padding: 10px 11px; border: 1px solid #e5e7eb; border-radius: 10px; font-size: 13px; color: #374151; outline: none; }',
    '.formulario input:focus { border-color: #fda4af; box-shadow: 0 0 0 3px rgba(225,29,72,.12); }',
    '.formulario .erro { font-size: 11px; color: #dc2626; margin: -4px 0 0; }',
    '.formulario button { margin-top: 4px; background: #e11d48; color: #fff; border: 0; border-radius: 10px; padding: 11px; font-size: 13px; font-weight: 600; cursor: pointer; }',
    '.formulario button:disabled { opacity: .5; cursor: not-allowed; }',
    '.formulario .nota { font-size: 10px; color: #9ca3af; text-align: center; margin: 2px 0 0; line-height: 1.4; }',
    '.oculto { display: none !important; }',
    '.rodape { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e5e7eb; background: #fff; flex-shrink: 0; }',
    '.campo { flex: 1; resize: none; border: 1px solid #e5e7eb; border-radius: 10px; padding: 9px 11px; font-size: 13px; color: #374151; outline: none; max-height: 90px; }',
    '.campo:focus { border-color: #fda4af; box-shadow: 0 0 0 3px rgba(225,29,72,.12); }',
    '.enviar { flex-shrink: 0; width: 36px; height: 36px; align-self: flex-end; border: 0; border-radius: 10px; background: #e11d48; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }',
    '.enviar:disabled { opacity: .4; cursor: not-allowed; }',
    '.enviar svg { width: 16px; height: 16px; }',
    '@media (max-width: 480px) { .painel { right: 10px; left: 10px; width: auto; bottom: 80px; } }',
  ].join('\n')

  // ---------------------------------------------------------------- montagem
  var host = document.createElement('div')
  host.setAttribute('data-lovehome-widget', '')
  var shadow = host.attachShadow({ mode: 'open' })

  var estilo = document.createElement('style')
  estilo.textContent = CSS
  shadow.appendChild(estilo)

  var botao = document.createElement('button')
  botao.className = 'botao'
  botao.setAttribute('aria-label', 'Abrir conversa')
  botao.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>'

  var painel = document.createElement('div')
  painel.className = 'painel'
  painel.innerHTML =
    '<div class="cabecalho">' +
    '<h3></h3><p></p>' +
    '<button class="fechar" aria-label="Fechar conversa">&times;</button>' +
    '</div>' +
    '<form class="formulario">' +
    '<p class="intro">Para eu te atender direito, me diz rapidinho:</p>' +
    '<div><label for="lh-nome">Nome</label><input id="lh-nome" type="text" autocomplete="name" placeholder="Como te chamo?"></div>' +
    '<div><label for="lh-fone">WhatsApp</label><input id="lh-fone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(11) 99999-8888"></div>' +
    '<p class="erro oculto"></p>' +
    '<button type="submit">Começar conversa</button>' +
    '<p class="nota">Usamos seu número só para continuar o atendimento pelo WhatsApp, se precisar.</p>' +
    '</form>' +
    '<div class="conversa oculto"></div>' +
    '<div class="rodape oculto">' +
    '<textarea class="campo" rows="1" placeholder="Escreva sua mensagem..."></textarea>' +
    '<button class="enviar" aria-label="Enviar">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>' +
    '</button></div>'

  shadow.appendChild(botao)
  shadow.appendChild(painel)

  painel.querySelector('.cabecalho h3').textContent = TITULO
  painel.querySelector('.cabecalho p').textContent = SUBTITULO

  var conversa = painel.querySelector('.conversa')
  var campo = painel.querySelector('.campo')
  var btEnviar = painel.querySelector('.enviar')
  var formulario = painel.querySelector('.formulario')
  var rodape = painel.querySelector('.rodape')
  var campoNome = painel.querySelector('#lh-nome')
  var campoFone = painel.querySelector('#lh-fone')
  var erroForm = painel.querySelector('.formulario .erro')
  var btComecar = painel.querySelector('.formulario button')

  /* Montar e desmontar sao publicos porque a vitrine e uma SPA: sair de
     /imoveis para /admin nao recarrega a pagina, e o que este script pendurou
     no <body> ficaria la — o balao do widget aparecendo por cima do painel.
     `window.__lovehomeWidgetPagina === false` e o sinal da pagina que carregou
     o script dizendo "ja sai": cobre o caso de o script terminar de carregar
     depois de a pessoa ter navegado. Site de terceiro nunca define a flag. */
  var montado = false

  function montar() {
    if (montado) return
    if (window.__lovehomeWidgetPagina === false) return
    montado = true
    if (document.body) document.body.appendChild(host)
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(host) })
  }

  function destruir() {
    montado = false
    if (aberto) alternar(false)
    if (timerPoll) {
      clearInterval(timerPoll)
      timerPoll = null
    }
    if (host.parentNode) host.parentNode.removeChild(host)
  }

  montar()

  // ---------------------------------------------------------------- conversa
  function balao(texto, meu) {
    var el = document.createElement('div')
    el.className = 'balao ' + (meu ? 'meu' : 'deles')
    el.textContent = texto
    conversa.appendChild(el)
    conversa.scrollTop = conversa.scrollHeight
  }

  function aviso(texto) {
    var el = document.createElement('div')
    el.className = 'aviso'
    el.textContent = texto
    conversa.appendChild(el)
    conversa.scrollTop = conversa.scrollHeight
  }

  function mostrarPensando(ligado) {
    var atual = conversa.querySelector('.pensando')
    if (ligado && !atual) {
      var el = document.createElement('div')
      el.className = 'pensando'
      el.innerHTML = '<span></span><span></span><span></span>'
      conversa.appendChild(el)
      conversa.scrollTop = conversa.scrollHeight
    } else if (!ligado && atual) {
      atual.remove()
    }
  }

  function corpoBase(extra) {
    var base = { siteId: SITE_ID, sessionToken: sessionToken }
    for (var k in extra) base[k] = extra[k]
    return JSON.stringify(base)
  }

  function mostrarChat() {
    formulario.classList.add('oculto')
    conversa.classList.remove('oculto')
    rodape.classList.remove('oculto')
  }

  function erroNoFormulario(texto) {
    erroForm.textContent = texto
    erroForm.classList.toggle('oculto', !texto)
  }

  async function identificar(e) {
    e.preventDefault()
    var nome = (campoNome.value || '').trim()
    var fone = (campoFone.value || '').trim()
    erroNoFormulario('')

    if (nome.length < 2) {
      erroNoFormulario('Por favor, me diga seu nome.')
      campoNome.focus()
      return
    }
    /* A mesma checagem roda no servidor. Aqui é só para não gastar uma ida e
       volta com um número visivelmente incompleto. */
    if (fone.replace(/\D/g, '').length < 10) {
      erroNoFormulario('Telefone incompleto — inclua o DDD.')
      campoFone.focus()
      return
    }

    btComecar.disabled = true
    btComecar.textContent = 'Iniciando...'

    try {
      if (!sessionToken) await abrirSessao()

      var r = await fetch(API + '/api/widget/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: SITE_ID, sessionToken: sessionToken, nome: nome, telefone: fone }),
      })
      var dados = await r.json()

      if (!r.ok) {
        erroNoFormulario(dados.erro || 'Não consegui iniciar. Tente de novo.')
        return
      }

      identificado = true
      primeiroNome = dados.primeiroNome || null
      try { localStorage.setItem(CHAVE_IDENTIDADE, '1') } catch { /* ignora */ }

      mostrarChat()
      if (!conversa.children.length) {
        balao(
          'Oi' + (primeiroNome ? ', ' + primeiroNome : '') +
            '! Posso ajudar a encontrar um imóvel para alugar ou comprar. O que você procura?',
          false
        )
      }
      campo.focus()
    } catch {
      erroNoFormulario('Sem conexão. Verifique a internet e tente de novo.')
    } finally {
      btComecar.disabled = false
      btComecar.textContent = 'Começar conversa'
    }
  }

  async function abrirSessao() {
    var salvo = null
    try { salvo = localStorage.getItem(CHAVE_SESSAO) } catch { /* modo privado (localStorage bloqueado) */ }

    var r = await fetch(API + '/api/widget/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId: SITE_ID,
        sessionToken: salvo || undefined,
        landingUrl: location.href,
        referrerUrl: document.referrer || null,
      }),
    })
    if (!r.ok) throw new Error('sessao')
    var dados = await r.json()
    sessionToken = dados.sessionToken
    try { localStorage.setItem(CHAVE_SESSAO, sessionToken) } catch { /* ignora */ }
    /* Sessão retomada de alguém que já se identificou: o servidor é quem sabe,
       e ele diz pelo `retomada`. O sinalizador local sozinho não bastaria —
       limpar o banco deixaria o widget achando que está identificado e todas as
       mensagens voltariam 428. */
    if (dados.retomada && dados.identificado) {
      identificado = true
      primeiroNome = dados.primeiroNome || null
    }
    return dados
  }

  async function enviar(texto) {
    if (!texto || enviando) return
    enviando = true
    btEnviar.disabled = true
    campo.value = ''
    balao(texto, true)
    mostrarPensando(true)

    try {
      if (!sessionToken) await abrirSessao()

      var r = await fetch(API + '/api/widget/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: corpoBase({ texto: texto, currentUrl: location.href }),
      })
      var dados = await r.json()
      mostrarPensando(false)

      if (r.status === 428) {
        /* A sessão perdeu o vínculo (banco limpo, sessão antiga). Volta ao
           formulário em vez de repetir um erro que a pessoa não pode resolver. */
        identificado = false
        conversa.classList.add('oculto')
        rodape.classList.add('oculto')
        formulario.classList.remove('oculto')
        erroNoFormulario('Preciso confirmar seus dados de novo antes de continuar.')
      } else if (r.status === 404) {
        /* Sessão sumiu (expirou ou o banco foi limpo). Abre outra e avisa, em
           vez de deixar a pessoa escrevendo no vazio. */
        try { localStorage.removeItem(CHAVE_SESSAO) } catch { /* ignora */ }
        sessionToken = null
        aviso('A conversa expirou. Mande a mensagem de novo para recomeçar.')
      } else if (!r.ok) {
        aviso(dados.erro || 'Não consegui enviar. Tente de novo.')
      } else {
        (dados.respostas || []).forEach(function (m) { balao(m.text, false) })
      }
    } catch {
      mostrarPensando(false)
      aviso('Sem conexão. Verifique a internet e tente de novo.')
    } finally {
      enviando = false
      btEnviar.disabled = false
      campo.focus()
    }
  }

  /* Follow-up e takeover humano chegam fora de qualquer requisição do
     visitante — sem esta sondagem eles só apareceriam quando ele escrevesse de
     novo, que é justamente quando já não fazem falta. */
  async function sondar() {
    if (!sessionToken || !aberto || enviando) return
    try {
      var url = API + '/api/widget/poll?sessao=' + encodeURIComponent(sessionToken) +
        (SITE_ID ? '&site=' + encodeURIComponent(SITE_ID) : '')
      var r = await fetch(url)
      if (!r.ok) return
      var dados = await r.json()
      ;(dados.respostas || []).forEach(function (m) { balao(m.text, false) })
    } catch { /* rede instável não vira erro na tela */ }
  }

  // ---------------------------------------------------------------- eventos
  function alternar(forcar) {
    aberto = typeof forcar === 'boolean' ? forcar : !aberto
    painel.classList.toggle('aberto', aberto)

    if (aberto) {
      /* A sessão é aberta ao ABRIR o painel, não ao carregar a página: quem
         nunca clica no botão não gera linha no banco. */
      abrirSessao()
        .then(function () {
          if (identificado) {
            mostrarChat()
            if (!conversa.children.length) {
              balao(
                'Oi' + (primeiroNome ? ', ' + primeiroNome : '') +
                  '! Posso ajudar a encontrar um imóvel para alugar ou comprar. O que você procura?',
                false
              )
            }
            campo.focus()
          } else {
            campoNome.focus()
          }
        })
        .catch(function () {
          erroNoFormulario('Não consegui abrir a conversa agora. Tente recarregar a página.')
        })

      if (!timerPoll) timerPoll = setInterval(sondar, INTERVALO_POLL)
    } else if (timerPoll) {
      clearInterval(timerPoll)
      timerPoll = null
    }
  }

  formulario.addEventListener('submit', identificar)
  botao.addEventListener('click', function () { alternar() })
  painel.querySelector('.fechar').addEventListener('click', function () { alternar(false) })
  btEnviar.addEventListener('click', function () { enviar(campo.value.trim()) })

  campo.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar(campo.value.trim())
    }
  })

  campo.addEventListener('input', function () {
    campo.style.height = 'auto'
    campo.style.height = Math.min(campo.scrollHeight, 90) + 'px'
  })

  window.LoveHomeWidget = {
    abrir: function () { alternar(true) },
    fechar: function () { alternar(false) },
    alternar: alternar,
    montar: montar,
    destruir: destruir,
  }
})()
