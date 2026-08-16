import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import {
  getConfiguracoes,
  salvarConfiguracoes,
  invalidarCacheConfig,
  normalizarWhatsapp,
  type Configuracoes,
} from '../lib/config/app'
import { debounceSegundos } from '../lib/debounce/queue'
import { rodarFollowups } from '../lib/followup/runner'
import { assumirConversa, devolverAoBot } from '../lib/conversas/takeover'
import { bloquearPorTelefone, desbloquear, listarBloqueados } from '../lib/channels/blocklist'

/* Configurações da aplicação. Rodar com: npm run check:configuracoes
   (o servidor de dev precisa estar no ar para as checagens HTTP)

   NÃO chama a OpenAI.

   O que está sendo protegido: configuração que a tela grava e ninguém lê é
   PIOR do que valor fixo no código, porque cria a impressão de que mexer nela
   muda alguma coisa. Cada campo aqui é verificado no consumidor de verdade —
   o follow-up sai da janela, o takeover expira no prazo novo, o debounce
   devolve o número novo, o botão da vitrine ganha o telefone.

   O teste RESTAURA a configuração original no fim: esta é a linha viva do
   sistema, não um registro descartável. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const supabase = createAdminClient()
const EDITOR = { userId: '', email: 'config@teste.local' }
const DOMINIO_TESTE = '@teste.lovehome.local'

let original: Configuracoes | null = null
let contatoId: string | null = null
const TELEFONE = '5511977010001'

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

/* Resíduo de execução anterior. Separado de `limpar()` porque aquele restaura
   a configuração a partir de `original` e zera a variável — chamá-lo no início
   destruiria a referência que o teste precisa guardar até o fim. Sem esta
   limpeza, o usuário de teste sobrevive e a segunda execução morre em "already
   been registered", com zero asserção rodada. */
async function limparResiduos() {
  const { data: usuarios } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  for (const u of usuarios?.users ?? []) {
    if (u.email?.endsWith(DOMINIO_TESTE)) await supabase.auth.admin.deleteUser(u.id)
  }

  const { data: contatos } = await supabase.from('contacts').select('id').eq('phone', TELEFONE)
  for (const c of contatos ?? []) {
    const { error } = await supabase.from('contacts').delete().eq('id', c.id)
    if (error) throw new Error(`limpeza de resíduo falhou: ${error.message}`)
  }
}

async function limpar() {
  if (original) {
    await supabase
      .from('app_settings')
      .update({
        nome_fantasia: original.nome_fantasia,
        whatsapp_numero: original.whatsapp_numero,
        email_contato: original.email_contato,
        endereco: original.endereco,
        creci: original.creci,
        followup_ativo: original.followup_ativo,
        followup_horas: original.followup_horas,
        followup_hora_inicio: original.followup_hora_inicio,
        followup_hora_fim: original.followup_hora_fim,
        followup_max_por_execucao: original.followup_max_por_execucao,
        takeover_horas: original.takeover_horas,
        debounce_segundos: original.debounce_segundos,
      })
      .eq('id', true)
    invalidarCacheConfig()
    original = null
  }

  if (contatoId) {
    const { error } = await supabase.from('contacts').delete().eq('id', contatoId)
    if (error) throw new Error(`limpeza do contato falhou: ${error.message}`)
    contatoId = null
  }

  const { data: usuarios } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  for (const u of usuarios?.users ?? []) {
    if (u.email?.endsWith(DOMINIO_TESTE)) await supabase.auth.admin.deleteUser(u.id)
  }
}

async function main() {
  await limparResiduos()

  original = await getConfiguracoes()
  console.log(
    `INFO  guardando a configuração atual para restaurar no fim (debounce=${original.debounce_segundos}s, takeover=${original.takeover_horas}h)\n`
  )

  const { data: usuario, error: erroUsuario } = await supabase.auth.admin.createUser({
    email: `config${DOMINIO_TESTE}`,
    password: 'senha-de-teste-12345',
    email_confirm: true,
    user_metadata: { full_name: 'Teste Config', role: 'admin' },
  })
  if (erroUsuario) throw new Error(`usuário: ${erroUsuario.message}`)
  EDITOR.userId = usuario.user!.id

  // ================= Validação =================
  console.log('--- Validação ---')

  ok('normaliza WhatsApp com máscara', normalizarWhatsapp('+55 (11) 99999-8888') === '5511999998888')
  /* Número curto demais deixaria o botão da vitrine abrir conversa com ninguém. */
  ok('recusa número curto', normalizarWhatsapp('99998888') === null)
  ok('vazio vira null', normalizarWhatsapp('') === null)

  const nomeVazio = await salvarConfiguracoes({ nome_fantasia: '  ' }, EDITOR)
  ok('nome vazio é recusado', !nomeVazio.ok && nomeVazio.status === 400)

  const zapRuim = await salvarConfiguracoes({ whatsapp_numero: '1234' }, EDITOR)
  ok('WhatsApp inválido é recusado', !zapRuim.ok && zapRuim.status === 400)

  /* Janela invertida deixaria o follow-up sem hora nenhuma para rodar, e o
     sintoma seria "parou de mandar", não "configuração errada". */
  const janelaRuim = await salvarConfiguracoes(
    { followup_hora_inicio: 20, followup_hora_fim: 9 },
    EDITOR
  )
  ok('janela invertida é recusada', !janelaRuim.ok && janelaRuim.status === 400)

  const foraDaFaixa = await salvarConfiguracoes({ debounce_segundos: 999 }, EDITOR)
  ok('número fora da faixa é recusado', !foraDaFaixa.ok && foraDaFaixa.status === 400)

  const semTentativa = await salvarConfiguracoes({ followup_horas: [] }, EDITOR)
  ok('lista de tentativas vazia é recusada', !semTentativa.ok && semTentativa.status === 400)

  const depoisDasRecusas = await getConfiguracoes()
  ok('nenhuma recusa alterou nada', depoisDasRecusas.nome_fantasia === original.nome_fantasia)

  // ================= Gravação =================
  console.log('\n--- Gravação ---')

  const salvou = await salvarConfiguracoes(
    {
      nome_fantasia: 'LoveHome Teste',
      whatsapp_numero: '+55 (11) 99999-9999',
      debounce_segundos: 7,
      takeover_horas: 3,
      followup_horas: [72, 24, 24],
    },
    EDITOR
  )
  ok('salvou', salvou.ok === true, JSON.stringify(salvou))

  const agora = await getConfiguracoes()
  ok('o cache foi invalidado na gravação', agora.nome_fantasia === 'LoveHome Teste')
  ok('o WhatsApp foi normalizado para dígitos', agora.whatsapp_numero === '5511999999999', agora.whatsapp_numero ?? '')
  /* A posição na lista É o número da tentativa, então ordem invertida faria a
     segunda sair antes da primeira. E repetido não é uma tentativa a mais. */
  ok('as tentativas ficam ordenadas e sem repetição', JSON.stringify(agora.followup_horas) === '[24,72]', JSON.stringify(agora.followup_horas))

  // ================= Os consumidores leem mesmo? =================
  console.log('\n--- Cada campo tem quem o leia ---')

  ok('debounce: o agrupador lê o valor novo', (await debounceSegundos()) === 7, String(await debounceSegundos()))

  // ---- takeover ----
  const { data: contato } = await supabase
    .from('contacts')
    .insert({ phone: TELEFONE, phone_key: TELEFONE.slice(-8), name: 'Teste Config' })
    .select('id')
    .single()
  contatoId = contato!.id

  const { data: conversa } = await supabase
    .from('conversations')
    .insert({ contact_id: contatoId, channel: 'widget', status: 'active' })
    .select('id')
    .single()

  const antes = Date.now()
  await assumirConversa({ conversationId: conversa!.id, userId: EDITOR.userId, email: EDITOR.email })

  const { data: assumida } = await supabase
    .from('conversations')
    .select('takeover_expires_at')
    .eq('id', conversa!.id)
    .single()

  const horasAteExpirar = (new Date(assumida!.takeover_expires_at!).getTime() - antes) / 3_600_000
  /* 3h foi o valor salvo acima. Se continuar 48, o campo é decorativo. */
  ok('takeover: a janela usa o valor novo', Math.abs(horasAteExpirar - 3) < 0.1, `${horasAteExpirar.toFixed(2)}h`)

  await devolverAoBot({ conversationId: conversa!.id, userId: EDITOR.userId, email: EDITOR.email })

  // ---- follow-up desligado ----
  await salvarConfiguracoes({ followup_ativo: false }, EDITOR)
  const desligado = await rodarFollowups()
  ok('follow-up: desligar para o cron de verdade', desligado.enviados === 0 && desligado.avaliados === 0, JSON.stringify(desligado))

  // ---- follow-up fora da janela ----
  const hora = Number(
    new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date())
  )
  /* Janela de uma hora que NÃO contém a hora atual: o cron precisa sair sem
     escrever. Escolhida a partir da hora corrente para o teste valer a
     qualquer momento do dia. */
  const inicioFora = (hora + 2) % 23
  await salvarConfiguracoes(
    { followup_ativo: true, followup_hora_inicio: inicioFora, followup_hora_fim: inicioFora + 1 },
    EDITOR
  )
  const foraDaJanela = await rodarFollowups()
  ok('follow-up: respeita a janela de horário', foraDaJanela.foraDeHorario === true, `agora ${hora}h, janela ${inicioFora}-${inicioFora + 1}h`)

  // ---- vitrine ----
  const { data: imovel } = await supabase
    .from('properties')
    .select('reference_code')
    .eq('status', 'disponivel')
    .limit(1)
    .single()

  const html = await (await fetch(`${BASE}/imoveis/${imovel!.reference_code}`)).text()
  /* A prova de que o campo chega ao cliente final: o link do botão tem o
     número salvo aqui. */
  ok('vitrine: o botão de WhatsApp usa o número salvo', html.includes('wa.me/5511999999999'), html.includes('wa.me/') ? 'tem wa.me com outro número' : 'sem wa.me')

  // ================= Bloqueio =================
  console.log('\n--- Contatos bloqueados ---')

  const inexistente = await bloquearPorTelefone('5511900000999', EDITOR.email)
  /* Só bloqueia quem já conversou: criar contato para bloquear preventivamente
     encheria a base de linhas fantasmas com o mesmo efeito prático. */
  ok('telefone sem contato é recusado', !inexistente.ok && inexistente.status === 404)

  const curto = await bloquearPorTelefone('123', EDITOR.email)
  ok('telefone curto é recusado', !curto.ok && curto.status === 400)

  const bloqueou = await bloquearPorTelefone('+55 (11) 97701-0001', EDITOR.email)
  ok('bloqueia casando pelos últimos 8 dígitos', bloqueou.ok === true, JSON.stringify(bloqueou))

  const { data: depoisBloqueio } = await supabase
    .from('contacts')
    .select('blocked')
    .eq('id', contatoId)
    .single()
  ok('a coluna foi marcada', depoisBloqueio?.blocked === true)

  const lista = await listarBloqueados()
  ok('aparece na lista da tela', lista.some((c) => c.id === contatoId))

  const denovo = await bloquearPorTelefone(TELEFONE, EDITOR.email)
  ok('bloquear duas vezes é recusado', !denovo.ok && denovo.status === 409)

  await desbloquear(contatoId!, EDITOR.email)
  const { data: depoisDesbloqueio } = await supabase
    .from('contacts')
    .select('blocked')
    .eq('id', contatoId)
    .single()
  ok('desbloquear volta atrás', depoisDesbloqueio?.blocked === false)

  // ================= Rotas =================
  console.log('\n--- Rotas ---')

  const patchSemSessao = await fetch(`${BASE}/api/admin/configuracoes`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome_fantasia: 'Invasor' }),
  })
  ok('salvar exige sessão', patchSemSessao.status === 401, `status ${patchSemSessao.status}`)

  const bloqueioSemSessao = await fetch(`${BASE}/api/admin/configuracoes/bloqueios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telefone: TELEFONE }),
  })
  ok('bloquear exige sessão', bloqueioSemSessao.status === 401)

  const { data: intacta } = await supabase
    .from('app_settings')
    .select('nome_fantasia')
    .eq('id', true)
    .single()
  ok('e nenhuma tentativa sem sessão gravou', intacta?.nome_fantasia !== 'Invasor')

  // ================= Restauração =================
  console.log('\n--- Restauração ---')

  const guardada = { ...original }
  await limpar()
  const restaurada = await getConfiguracoes()
  ok(
    'a configuração original foi restaurada',
    restaurada.debounce_segundos === guardada.debounce_segundos &&
      restaurada.takeover_horas === guardada.takeover_horas &&
      restaurada.nome_fantasia === guardada.nome_fantasia,
    `debounce=${restaurada.debounce_segundos}s takeover=${restaurada.takeover_horas}h`
  )

  console.log('\nDados de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})
