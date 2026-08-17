/* Agenda de visitas em horário de São Paulo. Rodar com: npm run check:agenda

   NÃO chama a OpenAI nem o banco — exercita lib/agenda (fuso + slots), que é a
   parte pura usada por check_broker_availability e create_visit.

   O que está sendo protegido: em produção o agente ficou em loop —
   "quinta às 10h" → "esse horário acabou de ser ocupado" → oferece sexta 10h →
   "ocupado" → oferece sexta 10h de novo. Causa: a consulta gerava os horários
   no relógio do servidor (UTC), o modelo lia "10:00" e dizia "10h", e a
   confirmação criava a visita às 10h -03:00 — outro instante. Dois cálculos,
   dois resultados. Agora é UM critério, sempre em São Paulo, e este check roda
   com TZ=UTC de propósito, como a Vercel. */

process.env.TZ = 'UTC'

import {
  agoraDescrito,
  dataHoraLocal,
  dataIsoLocal,
  dataLocal,
  dataPorExtenso,
  inicioDoDiaLocal,
  instanteLocal,
  interpretarDataHora,
  isoComFuso,
  offsetMinutos,
  partesLocais,
  rotuloHorario,
} from '../lib/agenda/fuso'
import { data as fmtData, dataHora as fmtDataHora } from '../lib/utils/format'
import {
  dentroDaJanela,
  escolherCorretor,
  gerarSlotsEquipe,
  gerarSlotsLivres,
  motivoIndisponivel,
} from '../lib/agenda/slots'
import { filtrarElegiveis, normalizarRegiao } from '../lib/agenda/equipe'
import { validarAgenda, validarRegioes } from '../lib/corretores/salvar'

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

// Seg-sex 9h-18h, sábado 9h-13h — a agenda do seed.
const JANELAS = [
  ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_time: '09:00:00', end_time: '18:00:00' })),
  { weekday: 6, start_time: '09:00:00', end_time: '13:00:00' },
]

function main() {
  console.log(`(processo em TZ=${process.env.TZ}, offset local do Node = ${new Date().getTimezoneOffset()} min)`)

  // ================= Fuso =================
  console.log('\n--- Fuso ---')

  // Segunda 17/08/2026 16:36 em São Paulo = 19:36Z
  const agora = new Date('2026-08-17T19:36:00Z')
  const p = partesLocais(agora)
  ok('19:36Z é 16:36 em São Paulo', p.hora === 16 && p.minuto === 36, `${p.hora}:${p.minuto}`)
  ok('17/08/2026 é segunda-feira', p.diaSemana === 1 && p.dia === 17, `diaSemana=${p.diaSemana}`)
  ok('offset de São Paulo é -180', offsetMinutos(agora) === -180, String(offsetMinutos(agora)))

  const quinta10 = instanteLocal(2026, 8, 20, 10)
  ok('quinta 20/08 10h SP = 13:00Z', quinta10.toISOString() === '2026-08-20T13:00:00.000Z', quinta10.toISOString())
  ok('isoComFuso mostra o -03:00', isoComFuso(quinta10) === '2026-08-20T10:00:00-03:00', isoComFuso(quinta10))
  ok('rótulo em português', rotuloHorario(quinta10) === 'quinta-feira 20/08 às 10h', rotuloHorario(quinta10))
  ok('rótulo com minutos', rotuloHorario(instanteLocal(2026, 8, 20, 15, 30)) === 'quinta-feira 20/08 às 15h30')
  ok('agoraDescrito', agoraDescrito(agora) === 'segunda-feira, 17/08/2026, 16:36', agoraDescrito(agora))
  ok('dia estourando o mês normaliza (31+3 → 03/09)', partesLocais(instanteLocal(2026, 8, 34, 12)).mes === 9)

  // Meia-noite em SP é 03:00Z do MESMO dia — sem virar o dia da semana errado.
  const meiaNoite = instanteLocal(2026, 8, 20, 0)
  ok('meia-noite SP não muda o dia', partesLocais(meiaNoite).dia === 20 && meiaNoite.toISOString() === '2026-08-20T03:00:00.000Z')

  // ================= "Hoje", início do dia e formatação =================
  console.log('\n--- inicioDoDiaLocal / formatação (22h em SP já é amanhã em UTC) ---')

  // Segunda 17/08 22:30 em SP = terça 18/08 01:30Z. Em UTC, "hoje" seria terça.
  const noite2230 = new Date('2026-08-18T01:30:00Z')
  ok('inicioDoDiaLocal(0) às 22h30 SP é meia-noite de SEGUNDA 17/08 (03:00Z)', inicioDoDiaLocal(0, noite2230).toISOString() === '2026-08-17T03:00:00.000Z', inicioDoDiaLocal(0, noite2230).toISOString())
  ok('inicioDoDiaLocal(1) é meia-noite de terça 18/08', inicioDoDiaLocal(1, noite2230).toISOString() === '2026-08-18T03:00:00.000Z')
  ok('inicioDoDiaLocal(-29) volta 29 dias (19/07)', dataIsoLocal(inicioDoDiaLocal(-29, noite2230)) === '2026-07-19')
  ok('dataIsoLocal às 22h30 SP é 17/08, não 18/08', dataIsoLocal(noite2230) === '2026-08-17', dataIsoLocal(noite2230))
  ok('dataLocal', dataLocal(noite2230) === '17/08/2026', dataLocal(noite2230))
  ok('dataHoraLocal', dataHoraLocal(noite2230) === '17/08 22:30', dataHoraLocal(noite2230))
  ok('dataPorExtenso', dataPorExtenso(noite2230) === '17 de agosto de 2026', dataPorExtenso(noite2230))
  ok('dataPorExtenso com dia da semana', dataPorExtenso(noite2230, true) === 'segunda-feira, 17 de agosto de 2026', dataPorExtenso(noite2230, true))
  ok('dataPorExtenso: virada de ano (31/12 23h SP = 01/01 02Z)', dataPorExtenso(new Date('2027-01-01T02:00:00Z')) === '31 de dezembro de 2026')

  // lib/utils/format passa a sair em SP também — no servidor (UTC) e no navegador.
  ok('format.dataHora de timestamp UTC sai em SP', fmtDataHora('2026-08-18T01:30:00Z') === '17/08 22:30', fmtDataHora('2026-08-18T01:30:00Z'))
  ok('format.data de DATE pura não mexe', fmtData('2026-08-18') === '18/08/2026', fmtData('2026-08-18'))
  ok('format.data de timestamp usa o dia de SP', fmtData('2026-08-18T01:30:00Z') === '17/08/2026', fmtData('2026-08-18T01:30:00Z'))
  ok('format.data/dataHora vazios', fmtData(null) === '—' && fmtDataHora(undefined) === '—')

  // ================= Interpretação do que o modelo manda =================
  console.log('\n--- interpretarDataHora ---')

  ok('com -03:00 respeita', interpretarDataHora('2026-08-20T10:00:00-03:00')?.getTime() === quinta10.getTime())
  ok('com Z respeita', interpretarDataHora('2026-08-20T13:00:00Z')?.getTime() === quinta10.getTime())
  ok('SEM fuso é São Paulo, não UTC', interpretarDataHora('2026-08-20T10:00:00')?.getTime() === quinta10.getTime(), interpretarDataHora('2026-08-20T10:00:00')?.toISOString())
  ok('sem segundos também', interpretarDataHora('2026-08-20T10:00')?.getTime() === quinta10.getTime())
  ok('lixo vira null', interpretarDataHora('quinta às 10h') === null)

  // ================= Slots =================
  console.log('\n--- gerarSlotsLivres (segunda 16:36 SP) ---')

  const livres = gerarSlotsLivres({ agora, dias: 7, janelas: JANELAS, bloqueios: [], ocupados: [] })
  const horasSP = livres.map((s) => partesLocais(s).hora)
  const rotulos = livres.map(rotuloHorario)
  ok('gerou horários', livres.length === 12, `${livres.length}`)
  ok('TODOS entre 9h e 17h em São Paulo (não em UTC)', horasSP.every((h) => h >= 9 && h <= 17), horasSP.join(','))
  ok('nada de hoje depois das 16:36 sem 2h de antecedência (17h cai fora)', !rotulos.some((r) => r.startsWith('segunda-feira 17/08')), rotulos[0])
  ok('começa terça 18/08 às 9h', rotulos[0] === 'terça-feira 18/08 às 9h', rotulos[0])
  ok('em ordem cronológica', livres.every((s, i) => i === 0 || s.getTime() > livres[i - 1].getTime()))

  // Consulta e confirmação concordam: todo slot devolvido passa em motivoIndisponivel.
  const ctx = { agora, janelas: JANELAS, bloqueios: [], ocupados: [] }
  ok('todo horário oferecido é aceito pela confirmação', livres.every((s) => motivoIndisponivel(s, ctx) === null))

  // O ISO com fuso que vai pro modelo volta para o MESMO instante.
  ok(
    'quando (ISO -03:00) → interpretarDataHora → mesmo instante',
    livres.every((s) => interpretarDataHora(isoComFuso(s))?.getTime() === s.getTime())
  )

  // ================= O cenário do loop =================
  console.log('\n--- Cenário do print: visita já existe quinta 10h SP ---')

  const ocupadoQuinta10 = [instanteLocal(2026, 8, 20, 10).getTime()]
  const comOcupado = gerarSlotsLivres({ agora, dias: 7, janelas: JANELAS, bloqueios: [], ocupados: ocupadoQuinta10, maximo: 40 })
  const rotulosOcupado = comOcupado.map(rotuloHorario)
  ok('quinta 10h NÃO é oferecida', !rotulosOcupado.includes('quinta-feira 20/08 às 10h'))
  ok('quinta 9h e 11h continuam livres', rotulosOcupado.includes('quinta-feira 20/08 às 9h') && rotulosOcupado.includes('quinta-feira 20/08 às 11h'))
  ok(
    'confirmar quinta 10h é recusado com o motivo certo',
    (motivoIndisponivel(instanteLocal(2026, 8, 20, 10), { ...ctx, ocupados: ocupadoQuinta10 }) ?? '').includes('ocupado')
  )
  ok('confirmar quinta 11h passa', motivoIndisponivel(instanteLocal(2026, 8, 20, 11), { ...ctx, ocupados: ocupadoQuinta10 }) === null)

  // ================= Janela e bloqueio na confirmação =================
  console.log('\n--- create_visit também respeita janela e bloqueio ---')

  ok('domingo não está na janela', !dentroDaJanela(instanteLocal(2026, 8, 23, 10), JANELAS))
  ok('sábado 12h está (9-13h)', dentroDaJanela(instanteLocal(2026, 8, 22, 12), JANELAS))
  ok('sábado 13h NÃO está (visita de 60min estouraria)', !dentroDaJanela(instanteLocal(2026, 8, 22, 13), JANELAS))
  ok('quinta 8h fora da janela', (motivoIndisponivel(instanteLocal(2026, 8, 20, 8), ctx) ?? '').includes('não atende'))
  ok('quinta 17h30 é aceito? não — a hora cheia é 17h e 17h30+60 passa das 18h', motivoIndisponivel(instanteLocal(2026, 8, 20, 17, 30), ctx) !== null)

  const bloqueio = { starts_at: instanteLocal(2026, 8, 20, 9).toISOString(), ends_at: instanteLocal(2026, 8, 20, 12).toISOString() }
  ok('bloqueio quinta 9-12h derruba 9h, 10h, 11h', (() => {
    const l = gerarSlotsLivres({ agora, dias: 7, janelas: JANELAS, bloqueios: [bloqueio], ocupados: [], maximo: 40 }).map(rotuloHorario)
    return !l.includes('quinta-feira 20/08 às 9h') && !l.includes('quinta-feira 20/08 às 11h') && l.includes('quinta-feira 20/08 às 12h')
  })())
  ok('confirmar dentro do bloqueio é recusado', (motivoIndisponivel(instanteLocal(2026, 8, 20, 10), { ...ctx, bloqueios: [bloqueio] }) ?? '').includes('bloqueado'))
  ok('passado é recusado', (motivoIndisponivel(instanteLocal(2026, 8, 17, 10), ctx) ?? '').includes('passou'))
  ok('em cima da hora é recusado', (motivoIndisponivel(instanteLocal(2026, 8, 17, 17), ctx) ?? '').includes('em cima da hora'))

  // ================= Virada de dia UTC =================
  console.log('\n--- 22h em SP (já é amanhã em UTC) ---')

  const noite = new Date('2026-08-18T01:00:00Z') // segunda 22h SP
  const deNoite = gerarSlotsLivres({ agora: noite, dias: 2, janelas: JANELAS, bloqueios: [], ocupados: [] })
  ok('primeiro horário é terça 18/08 às 9h (não quarta)', rotuloHorario(deNoite[0]) === 'terça-feira 18/08 às 9h', rotuloHorario(deNoite[0]))

  // ================= Almoço =================
  console.log('\n--- Intervalo de almoço ---')

  const COM_ALMOCO = JANELAS.map((j) =>
    j.weekday === 6 ? j : { ...j, break_start: '12:00:00', break_end: '13:00:00' }
  )
  const comAlmoco = gerarSlotsLivres({ agora, dias: 3, janelas: COM_ALMOCO, bloqueios: [], ocupados: [], maximo: 40 }).map(rotuloHorario)
  ok('terça 12h some (almoço 12–13)', !comAlmoco.includes('terça-feira 18/08 às 12h'), comAlmoco.filter((r) => r.startsWith('terça')).join(', '))
  ok('terça 11h e 13h continuam', comAlmoco.includes('terça-feira 18/08 às 11h') && comAlmoco.includes('terça-feira 18/08 às 13h'))
  ok('confirmar no almoço dá o motivo "almoço"', (motivoIndisponivel(instanteLocal(2026, 8, 18, 12), { ...ctx, janelas: COM_ALMOCO }) ?? '').includes('almoço'))
  ok('almoço 12:30–13:30 derruba 12h E 13h (visita de 1h encosta nos dois)', (() => {
    const j = JANELAS.map((x) => (x.weekday === 6 ? x : { ...x, break_start: '12:30', break_end: '13:30' }))
    const l = gerarSlotsLivres({ agora, dias: 2, janelas: j, bloqueios: [], ocupados: [], maximo: 40 }).map(rotuloHorario)
    return !l.includes('terça-feira 18/08 às 12h') && !l.includes('terça-feira 18/08 às 13h') && l.includes('terça-feira 18/08 às 14h')
  })())

  // ================= Equipe: união e escolha =================
  console.log('\n--- Vários corretores no mesmo horário ---')

  const renata = { id: 'renata', nome: 'Renata Alves', janelas: COM_ALMOCO, bloqueios: [], ocupados: [instanteLocal(2026, 8, 18, 9).getTime()] }
  const diego = {
    id: 'diego',
    nome: 'Diego Nunes',
    // Só tarde: 14h–18h
    janelas: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_time: '14:00', end_time: '18:00' })),
    bloqueios: [],
    ocupados: [],
  }
  const equipe = gerarSlotsEquipe({ agora, dias: 2, corretores: [renata, diego], maximo: 40 }).map(rotuloHorario)
  ok('união: terça 9h some (Renata ocupada e Diego não atende de manhã)', !equipe.includes('terça-feira 18/08 às 9h'))
  ok('união: terça 10h aparece (Renata livre)', equipe.includes('terça-feira 18/08 às 10h'))
  ok('união: terça 14h aparece uma vez só (os dois livres)', equipe.filter((r) => r === 'terça-feira 18/08 às 14h').length === 1)
  ok('união começa no primeiro slot livre de alguém (terça 10h)', equipe[0] === 'terça-feira 18/08 às 10h', equipe[0])

  const params = { agora, corretores: [renata, diego] }
  const t14 = instanteLocal(2026, 8, 18, 14)
  ok('slot livre para os dois + responsável = Renata → Renata', escolherCorretor(t14, params, 'renata').corretor?.id === 'renata')
  ok('slot livre para os dois + responsável = Diego → Diego', escolherCorretor(t14, params, 'diego').corretor?.id === 'diego')
  ok('sem responsável na equipe → quem tem menos visitas no dia (Diego, 0 vs Renata, 1)', escolherCorretor(t14, params, null).corretor?.id === 'diego')
  ok('responsável ocupado às 9h → ninguém (Diego não atende de manhã), motivo do responsável', (() => {
    const r = escolherCorretor(instanteLocal(2026, 8, 18, 9), params, 'renata')
    return r.corretor === null && (r.motivo ?? '').includes('ocupado')
  })())
  ok('responsável ocupado, outro livre → o outro', escolherCorretor(instanteLocal(2026, 8, 18, 15), { agora, corretores: [{ ...renata, ocupados: [instanteLocal(2026, 8, 18, 15).getTime()] }, diego] }, 'renata').corretor?.id === 'diego')
  ok('empate de carga → ordem alfabética (Diego antes de Renata)', escolherCorretor(t14, { agora, corretores: [{ ...renata, ocupados: [] }, diego] }, null).corretor?.id === 'diego')

  // ================= Conflito por IMÓVEL (corretores diferentes) =================
  console.log('\n--- Um imóvel, uma visita por vez ---')

  // Renata e Diego livres às 15h; mas o apartamento já tem visita às 15h com um terceiro.
  const t15 = instanteLocal(2026, 8, 18, 15)
  const soImovel = { agora, corretores: [{ ...renata, ocupados: [] }, diego], ocupadosImovel: [t15.getTime()] }
  ok('slot some da união mesmo com os dois corretores livres', !gerarSlotsEquipe({ ...soImovel, dias: 2, maximo: 40 }).some((s) => s.getTime() === t15.getTime()))
  ok('16h continua na união (só o imóvel às 15h está ocupado)', gerarSlotsEquipe({ ...soImovel, dias: 2, maximo: 40 }).some((s) => s.getTime() === instanteLocal(2026, 8, 18, 16).getTime()))
  const rImovel = escolherCorretor(t15, soImovel, 'renata')
  ok('confirmar às 15h é recusado com motivo do IMÓVEL, mesmo com corretor livre', rImovel.corretor === null && (rImovel.motivo ?? '').includes('imóvel'), rImovel.motivo ?? '')
  ok('às 16h escolhe normalmente', escolherCorretor(instanteLocal(2026, 8, 18, 16), soImovel, 'renata').corretor?.id === 'renata')
  ok('visita no imóvel às 15h30 também derruba 15h e 16h (janela de 1h)', (() => {
    const p2 = { ...soImovel, ocupadosImovel: [instanteLocal(2026, 8, 18, 15, 30).getTime()] }
    const l = gerarSlotsEquipe({ ...p2, dias: 2, maximo: 40 }).map((s) => s.getTime())
    return !l.includes(t15.getTime()) && !l.includes(instanteLocal(2026, 8, 18, 16).getTime()) && l.includes(instanteLocal(2026, 8, 18, 17).getTime())
  })())

  // ================= Elegibilidade por bairro =================
  console.log('\n--- Quem pode atender o imóvel ---')

  const ativos = [
    { id: 'renata', name: 'Renata', phone: null, email: null, region_focus: ['Vila Mariana', 'Paraíso'] },
    { id: 'diego', name: 'Diego', phone: null, email: null, region_focus: ['Pinheiros'] },
    { id: 'marcos', name: 'Marcos', phone: null, email: null, region_focus: ['vila  mariana'] },
  ]
  ok('normalizarRegiao ignora caixa, acento e espaço', normalizarRegiao('  Vila  MARIANA ') === 'vila mariana' && normalizarRegiao('Paraíso') === 'paraiso')
  const e1 = filtrarElegiveis(ativos, { broker_id: 'diego', region: 'Vila Mariana' })
  ok('responsável (Diego) + quem atende o bairro (Renata, Marcos)', e1.elegiveis.map((c) => c.id).sort().join(',') === 'diego,marcos,renata' && e1.criterio === 'responsavel_e_regiao', e1.elegiveis.map((c) => c.id).join(','))
  const e2 = filtrarElegiveis(ativos, { broker_id: null, region: 'Moema' })
  ok('ninguém atende o bairro e sem responsável → todos os ativos (fallback)', e2.elegiveis.length === 3 && e2.criterio === 'todos_ativos')
  ok('sem corretor ativo → ninguém', filtrarElegiveis([], { broker_id: 'x', region: 'Moema' }).criterio === 'ninguem')

  // ================= Validação do formulário =================
  console.log('\n--- validarAgenda / validarRegioes (o que a tela manda) ---')

  const v1 = validarAgenda([{ weekday: 1, start_time: '09:00', end_time: '18:00', break_start: '12:00', break_end: '13:00' }])
  ok('agenda válida passa e normaliza', v1.ok && v1.dias[0].break_start === '12:00')
  ok('aceita HH:MM:SS do banco', validarAgenda([{ weekday: 1, start_time: '09:00:00', end_time: '18:00:00' }]).ok)
  ok('fim antes do início falha', !validarAgenda([{ weekday: 1, start_time: '18:00', end_time: '09:00' }]).ok)
  ok('janela menor que 1h falha', !validarAgenda([{ weekday: 1, start_time: '09:00', end_time: '09:30' }]).ok)
  ok('almoço fora da janela falha', !validarAgenda([{ weekday: 1, start_time: '09:00', end_time: '18:00', break_start: '18:00', break_end: '19:00' }]).ok)
  ok('almoço só com início falha', !validarAgenda([{ weekday: 1, start_time: '09:00', end_time: '18:00', break_start: '12:00', break_end: '' }]).ok)
  ok('almoço invertido falha', !validarAgenda([{ weekday: 1, start_time: '09:00', end_time: '18:00', break_start: '13:00', break_end: '12:00' }]).ok)
  ok('dia repetido falha', !validarAgenda([{ weekday: 1, start_time: '09:00', end_time: '18:00' }, { weekday: 1, start_time: '09:00', end_time: '12:00' }]).ok)
  ok('weekday 7 falha', !validarAgenda([{ weekday: 7, start_time: '09:00', end_time: '18:00' }]).ok)
  ok('hora inválida falha', !validarAgenda([{ weekday: 1, start_time: '25:00', end_time: '18:00' }]).ok)
  const r1 = validarRegioes([' Vila Mariana ', 'vila mariana', '', 'Paraíso'])
  ok('regiões: limpa, deduplica sem caixa, ignora vazio', r1.ok && r1.regioes.join('|') === 'Vila Mariana|Paraíso', r1.ok ? r1.regioes.join('|') : r1.erro)

  console.log(process.exitCode ? '\nHouve falhas.' : '\nTudo certo.')
}

main()
