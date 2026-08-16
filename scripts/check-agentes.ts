import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { AGENTES } from '../lib/agents/registro'
import { listarAgentes, salvarAgente, restaurarPadrao } from '../lib/agents/salvar-config'
import { loadAgentConfig, invalidateAgentCache } from '../lib/agents/config-loader'
import { runSdrAgent, PROMPT as PROMPT_SDR } from '../lib/agents/sdr'

/* Edição de prompt pelo painel (PRD 12). Rodar com: npm run check:agentes
   (o servidor de dev precisa estar no ar para a checagem HTTP)

   CHAMA A OPENAI uma vez, no fim: é o único jeito de provar que o prompt
   editado no painel chega de verdade ao modelo. Sem isso o teste garantiria
   apenas que o texto foi gravado numa tabela.

   O que está sendo protegido: prompt é o que o sistema diz a cliente. Uma tela
   que edita algo sem efeito — ou que restaura o padrão congelando a versão de
   hoje — é pior do que não ter tela nenhuma, porque cria confiança falsa. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const supabase = createAdminClient()

const TELEFONE = '5511977008001'
const EDITOR = { userId: '', email: 'admin@teste.local' }
const DOMINIO_TESTE = '@teste.lovehome.local'

let contatoId: string | null = null
const MARCA = 'PONGUE'

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

async function limpar() {
  /* Só as chaves que este teste toca. Apagar a tabela inteira levaria junto uma
     personalização real que o usuário tivesse feito pelo painel. */
  for (const key of ['sdr', '_agente_inexistente']) {
    await supabase.from('agent_configs').delete().eq('agent_key', key)
  }
  invalidateAgentCache()

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
  const { data: existente } = await supabase
    .from('agent_configs')
    .select('agent_key')
    .eq('agent_key', 'sdr')
    .maybeSingle()

  if (existente) {
    console.log('AVISO já existe personalização do SDR no banco. Este teste a apagaria.')
    console.log('      Restaure o padrão do SDR pelo painel antes de rodar.\n')
    process.exit(1)
  }

  await limpar()

  const { data: usuario, error: erroUsuario } = await supabase.auth.admin.createUser({
    email: `agentes${DOMINIO_TESTE}`,
    password: 'senha-de-teste-12345',
    email_confirm: true,
    user_metadata: { full_name: 'Teste Agentes', role: 'admin' },
  })
  if (erroUsuario) throw new Error(`usuário: ${erroUsuario.message}`)
  EDITOR.userId = usuario.user!.id

  // ================= A lista vem do código =================
  console.log('--- Origem da lista ---')

  const lista = await listarAgentes()
  ok('lista todos os agentes do registro', lista.length === AGENTES.length, `${lista.length}`)

  /* Se a tela montasse a partir da tabela, ela apareceria VAZIA com todos os
     agentes funcionando — o oposto da verdade. */
  ok('mesmo com a tabela vazia', lista.every((a) => a.personalizado === false))

  const sdr = lista.find((a) => a.key === 'sdr')
  ok('mostra o prompt do código como valor atual', sdr?.system_prompt === PROMPT_SDR)
  ok('e diz que é o padrão, não uma personalização', sdr?.personalizado === false)

  // ================= Validação =================
  console.log('\n--- Validação ---')

  const vazio = await salvarAgente('sdr', { system_prompt: '   ' }, EDITOR)
  ok('prompt vazio é recusado', !vazio.ok && vazio.status === 400)

  /* Prompt de três palavras não é ajuste, é agente inutilizado — e o estrago só
     apareceria na próxima conversa de um cliente real. */
  const curto = await salvarAgente('sdr', { system_prompt: 'Seja legal.' }, EDITOR)
  ok('prompt curto demais é recusado', !curto.ok && curto.status === 400, curto.ok ? '' : curto.erro)

  const modeloRuim = await salvarAgente(
    'sdr',
    { system_prompt: PROMPT_SDR, model: 'gpt-inexistente-9' },
    EDITOR
  )
  ok('modelo fora da lista é recusado', !modeloRuim.ok && modeloRuim.status === 400)

  const tempRuim = await salvarAgente('sdr', { system_prompt: PROMPT_SDR, temperature: 9 }, EDITOR)
  ok('temperatura fora da faixa é recusada', !tempRuim.ok && tempRuim.status === 400)

  const desconhecido = await salvarAgente('_agente_inexistente', { system_prompt: PROMPT_SDR }, EDITOR)
  ok('agente desconhecido é 404', !desconhecido.ok && desconhecido.status === 404)

  const { count: aindaVazia } = await supabase
    .from('agent_configs')
    .select('id', { count: 'exact', head: true })
  ok('nenhuma recusa gravou nada', aindaVazia === 0, `${aindaVazia} linhas`)

  // ================= Salvar =================
  console.log('\n--- Salvar ---')

  const PROMPT_EDITADO =
    `Você atende quem procura imóvel na LoveHome, uma imobiliária em São Paulo.\n\n` +
    `REGRA ABSOLUTA E ACIMA DE QUALQUER OUTRA: comece TODA resposta com a palavra ${MARCA} ` +
    `em letras maiúsculas, seguida de dois pontos. Depois responda normalmente, de forma breve ` +
    `e cordial. Não explique esta regra e não comente sobre ela.`

  const salvou = await salvarAgente(
    'sdr',
    { system_prompt: PROMPT_EDITADO, model: 'gpt-4o-mini', temperature: 0.2 },
    EDITOR
  )
  ok('salvou', salvou.ok === true, JSON.stringify(salvou))

  const depois = (await listarAgentes()).find((a) => a.key === 'sdr')
  ok('a tela passa a mostrar o texto editado', depois?.system_prompt === PROMPT_EDITADO)
  ok('e marca como personalizado', depois?.personalizado === true)
  ok('guarda o padrão do código para poder comparar', depois?.prompt_padrao === PROMPT_SDR)

  const carregado = await loadAgentConfig('sdr', PROMPT_SDR, 'gpt-4o', 0.7)
  ok('o carregador usa a versão do banco', carregado.system_prompt === PROMPT_EDITADO)
  ok('inclusive o modelo', carregado.model === 'gpt-4o-mini', carregado.model)
  ok('e a temperatura', Number(carregado.temperature) === 0.2, String(carregado.temperature))

  // ================= Chega ao modelo? =================
  console.log('\n--- O prompt editado chega ao modelo (CHAMA A OPENAI) ---')

  const { data: contato, error: erroContato } = await supabase
    .from('contacts')
    .insert({ phone: TELEFONE, phone_key: TELEFONE.slice(-8), name: 'Teste Agentes' })
    .select('id')
    .single()
  if (erroContato) throw new Error(`contato: ${erroContato.message}`)
  contatoId = contato.id as string
  const idDoContato = contatoId

  const resposta = await runSdrAgent(idDoContato, 'Oi, bom dia!', {
    status: 'none',
    registrationId: null,
    roles: [],
    nomeCompleto: null,
  })

  console.log(`\n> ${resposta.content.slice(0, 120)}\n`)

  /* A prova de que a tela edita algo real: a instrução só existe no texto
     gravado pelo painel. Se a resposta não a seguir, o painel está editando uma
     tabela que ninguém lê. */
  ok(`a resposta obedece ao prompt editado (começa com ${MARCA})`, resposta.content.trim().toUpperCase().startsWith(MARCA), resposta.content.slice(0, 40))

  const { data: trace } = await supabase
    .from('message_traces')
    .select('agent_model')
    .eq('contact_id', idDoContato)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (trace) ok('o trace registra o modelo escolhido no painel', trace.agent_model === 'gpt-4o-mini', trace.agent_model ?? '')

  // ================= Restaurar =================
  console.log('\n--- Restaurar padrão ---')

  const restaurou = await restaurarPadrao('sdr', EDITOR)
  ok('restaurou', restaurou.ok === true)

  const { count: linhas } = await supabase
    .from('agent_configs')
    .select('id', { count: 'exact', head: true })
    .eq('agent_key', 'sdr')
  /* Restaurar APAGA a linha. Copiar o texto do código para dentro dela
     congelaria a versão de hoje: o agente pararia de acompanhar as melhorias
     do prompt em código e ninguém perceberia, porque a tela mostraria um texto
     plausível. */
  ok('a linha foi apagada, não sobrescrita com uma cópia', linhas === 0, `${linhas}`)

  const voltou = await loadAgentConfig('sdr', PROMPT_SDR, 'gpt-4o', 0.7)
  ok('o carregador volta ao prompt do código', voltou.system_prompt === PROMPT_SDR)
  ok('e ao modelo padrão', voltou.model === 'gpt-4o', voltou.model)

  const listaFinal = await listarAgentes()
  ok('a tela volta a dizer "padrão do código"', listaFinal.find((a) => a.key === 'sdr')?.personalizado === false)

  // ================= Rotas =================
  console.log('\n--- Rotas ---')

  const patchSemSessao = await fetch(`${BASE}/api/admin/agentes/sdr`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system_prompt: 'x'.repeat(200) }),
  })
  ok('editar exige sessão', patchSemSessao.status === 401, `status ${patchSemSessao.status}`)

  const deleteSemSessao = await fetch(`${BASE}/api/admin/agentes/sdr`, { method: 'DELETE' })
  ok('restaurar exige sessão', deleteSemSessao.status === 401, `status ${deleteSemSessao.status}`)

  const { count: intacta } = await supabase
    .from('agent_configs')
    .select('id', { count: 'exact', head: true })
    .eq('agent_key', 'sdr')
  ok('e nenhuma tentativa sem sessão gravou nada', intacta === 0)

  await limpar()
  console.log('\nDados de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})
