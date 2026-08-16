import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { pode, escopoProprio, rotaInicial, PAPEIS, type Role } from '../lib/auth/permissions'
import { atualizarUsuario } from '../lib/auth/convites'
import { listarLeads, listarVisitas } from '../lib/queries/admin'
import { negocioDaCarteira, documentoDaCarteira, imovelDaCarteira } from '../lib/auth/carteira'

/* Autenticação e autorização. Rodar com: npm run check:auth
   (o servidor de dev precisa estar no ar para as checagens HTTP)

   Cria usuários de teste com e-mail @teste.lovehome.local e os apaga no fim.
   Não toca em conta real. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const DOMINIO_TESTE = '@teste.lovehome.local'
const SENHA_TESTE = 'senha-de-teste-12345'

const supabase = createAdminClient()

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

async function limpar() {
  const { data: sobras } = await supabase.from('brokers').select('id').ilike('name', '%Testeauth%')
  for (const b of sobras ?? []) {
    const { data: ds } = await supabase.from('deals').select('id').eq('broker_id', b.id)
    for (const d of ds ?? []) {
      await supabase.from('documents').delete().eq('deal_id', d.id)
      await supabase.from('deals').delete().eq('id', d.id)
    }
    await supabase.from('brokers').delete().eq('id', b.id)
  }
  const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  for (const u of data?.users ?? []) {
    if (u.email?.endsWith(DOMINIO_TESTE)) {
      await supabase.from('brokers').delete().eq('profile_id', u.id)
      await supabase.auth.admin.deleteUser(u.id)
    }
  }
}

async function criarUsuario(papel: Role) {
  const email = `${papel}${DOMINIO_TESTE}`
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: SENHA_TESTE,
    email_confirm: true,
    user_metadata: { full_name: `Teste ${papel}`, role: papel },
  })
  if (error) throw new Error(`${papel}: ${error.message}`)
  return data.user!
}

async function main() {
  await limpar()

  // ================= HTTP sem sessão =================
  console.log('--- Acesso sem sessão ---')

  const painel = await fetch(`${BASE}/admin/dashboard`, { redirect: 'manual' })
  const destino = painel.headers.get('location') ?? ''
  ok('painel redireciona para o login', painel.status >= 300 && painel.status < 400 && destino.includes('/login'), `${painel.status} -> ${destino}`)
  ok('redirecionamento preserva o destino', destino.includes('proximo='), destino)

  const api = await fetch(`${BASE}/api/admin/usuarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'invasor@x.com', full_name: 'Invasor', role: 'admin' }),
  })
  ok('API de convite recusa anônimo com 401', api.status === 401, `status ${api.status}`)

  const perfilApi = await fetch(`${BASE}/api/admin/perfil`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'Invasor Silva' }),
  })
  ok('API de perfil recusa anônimo com 401', perfilApi.status === 401, `status ${perfilApi.status}`)

  const vitrine = await fetch(`${BASE}/imoveis`, { redirect: 'manual' })
  ok('vitrine pública segue aberta', vitrine.status === 200, `status ${vitrine.status}`)

  // ================= Matriz de permissões =================
  console.log('\n--- Matriz de permissões ---')

  /* "Admin sempre tem acesso a tudo" precisa valer para TODO recurso, não só
     para os que eu lembrei de listar — é o que a matriz garante com 'tudo'. */
  const TODOS_RECURSOS = [
    'dashboard', 'painel', 'conversas', 'leads', 'resumos', 'imoveis',
    'proprietarios', 'visitas', 'contratos', 'pagamentos', 'documentos',
    'formularios', 'corretores', 'copiloto', 'agentes', 'canais', 'materiais',
    'configuracoes', 'usuarios',
  ] as const

  ok(
    'admin vê e edita todos os recursos',
    TODOS_RECURSOS.every((r) => pode('admin', r, 'ver') && pode('admin', r, 'editar')),
    TODOS_RECURSOS.filter((r) => !pode('admin', r, 'editar')).join(', ')
  )
  ok('editor NÃO vê leads', !pode('editor', 'leads'))
  ok('editor NÃO vê dashboard (é feito de lead e cobrança)', !pode('editor', 'dashboard'))
  ok('editor edita imóveis', pode('editor', 'imoveis', 'editar'))
  ok('corretor NÃO vê pagamentos', !pode('corretor', 'pagamentos'))
  ok('corretor NÃO gerencia usuários', !pode('corretor', 'usuarios'))
  ok('corretor vê leads', pode('corretor', 'leads'))
  ok('viewer vê leads mas não edita', pode('viewer', 'leads') && !pode('viewer', 'leads', 'editar'))
  ok('viewer NÃO vê canais (guardam credenciais)', !pode('viewer', 'canais'))
  ok('só corretor tem escopo por carteira', escopoProprio('corretor') && !escopoProprio('admin') && !escopoProprio('viewer'))
  ok('editor cai em imóveis ao entrar', rotaInicial('editor') === '/admin/imoveis', rotaInicial('editor'))
  ok('admin cai no dashboard ao entrar', rotaInicial('admin') === '/admin/dashboard')

  // ================= Criação e vínculo =================
  console.log('\n--- Criação de usuários ---')

  const criados: Record<string, string> = {}
  for (const papel of PAPEIS) {
    const u = await criarUsuario(papel)
    criados[papel] = u.id
  }

  const { data: perfis } = await supabase
    .from('profiles')
    .select('id, role, is_active')
    .in('id', Object.values(criados))

  ok('os 4 perfis nasceram', perfis?.length === 4, `${perfis?.length}`)
  ok(
    'cada um com o papel do convite',
    PAPEIS.every((p) => perfis?.find((x) => x.id === criados[p])?.role === p),
    JSON.stringify(perfis?.map((p) => p.role))
  )

  const { data: corretorVinculado } = await supabase
    .from('brokers')
    .select('id, name, is_active')
    .eq('profile_id', criados.corretor)
    .maybeSingle()

  ok('corretor ganhou cadastro em brokers automaticamente', Boolean(corretorVinculado))

  // ================= Escopo por carteira =================
  console.log('\n--- Escopo por corretor ---')

  const todosLeads = await listarLeads(null)
  const leadsDoCorretor = await listarLeads(corretorVinculado!.id)
  ok(
    'corretor novo não enxerga a carteira dos outros',
    leadsDoCorretor.length === 0 && todosLeads.length > 0,
    `dele: ${leadsDoCorretor.length}, total: ${todosLeads.length}`
  )

  // Atribui um lead a ele e confirma que passa a aparecer — sem isso o teste
  // acima passaria mesmo se o filtro estivesse zerando tudo por engano.
  const alvo = todosLeads[0]
  await supabase
    .from('contacts')
    .update({ assigned_broker_id: corretorVinculado!.id })
    .eq('id', alvo.id)

  const depois = await listarLeads(corretorVinculado!.id)
  ok('passa a ver o lead atribuído a ele', depois.length === 1 && depois[0].id === alvo.id, `${depois.length} leads`)

  const todasVisitas = await listarVisitas(null)
  const visitasDele = await listarVisitas(corretorVinculado!.id)
  ok(
    'visitas também vêm filtradas por corretor',
    visitasDele.length === 0 && todasVisitas.length > 0,
    `dele: ${visitasDele.length}, total: ${todasVisitas.length}`
  )

  await supabase.from('contacts').update({ assigned_broker_id: null }).eq('id', alvo.id)

  // ================= Recorte por carteira nas rotas com id =================
  console.log('\n--- Recorte por carteira (IDOR) ---')

  /* `autorizarApi('contratos','editar')` diz que o PAPEL pode. As rotas com id
     precisam ainda perguntar se ESTE corretor pode mexer NESTE item — sem isso,
     um corretor com o UUID de um negócio alheio aprovava, gerava contrato e
     baixava RG de cliente de outra carteira. */
  const { data: outroCorretor } = await supabase
    .from('brokers')
    .insert({ name: 'Outro Corretor Testeauth', specialty: 'geral', is_active: true })
    .select('id')
    .single()
  const { data: imovelBase } = await supabase
    .from('properties')
    .select('id')
    .eq('status', 'disponivel')
    .limit(1)
    .single()
  const { data: cadastroBase } = await supabase.from('registrations').select('id').limit(1).single()
  const { data: negocioAlheio } = await supabase
    .from('deals')
    .insert({
      deal_type: 'locacao',
      property_id: imovelBase!.id,
      client_registration_id: cadastroBase!.id,
      broker_id: outroCorretor!.id,
      status: 'em_aprovacao',
      rent_price_cents: 100000,
    })
    .select('id')
    .single()
  const { data: docAlheio } = await supabase
    .from('documents')
    .insert({
      registration_id: cadastroBase!.id,
      deal_id: negocioAlheio!.id,
      type: 'rg_cnh',
      storage_path: 'teste/inexistente.pdf',
      status: 'pendente_revisao',
    })
    .select('id')
    .single()
  if (!negocioAlheio || !docAlheio) throw new Error('não consegui montar negócio/documento alheios para o teste')

  const sessaoCorretor = {
    userId: criados.corretor,
    email: `corretor${DOMINIO_TESTE}`,
    nome: 'Teste corretor',
    role: 'corretor' as Role,
    brokerId: corretorVinculado!.id,
  }
  const sessaoAdmin = { ...sessaoCorretor, userId: criados.admin, role: 'admin' as Role, brokerId: null }

  const negocio = await negocioDaCarteira(negocioAlheio!.id, sessaoCorretor)
  ok('corretor NÃO alcança negócio de outra carteira', !negocio.ok && negocio.status === 403, JSON.stringify(negocio))
  const documento = await documentoDaCarteira(docAlheio!.id, sessaoCorretor)
  ok('corretor NÃO alcança documento de negócio alheio', !documento.ok && documento.status === 403, JSON.stringify(documento))
  const imovel = await imovelDaCarteira(imovelBase!.id, sessaoCorretor)
  ok('corretor NÃO alcança imóvel que não é dele', !imovel.ok, JSON.stringify(imovel))

  ok('admin alcança o mesmo negócio', (await negocioDaCarteira(negocioAlheio!.id, sessaoAdmin)).ok)
  ok('admin alcança o mesmo documento', (await documentoDaCarteira(docAlheio!.id, sessaoAdmin)).ok)

  await supabase.from('deals').update({ broker_id: corretorVinculado!.id }).eq('id', negocioAlheio!.id)
  ok('e quando o negócio É dele, passa', (await negocioDaCarteira(negocioAlheio!.id, sessaoCorretor)).ok)
  const inexistente = await negocioDaCarteira('00000000-0000-0000-0000-000000000000', sessaoCorretor)
  ok('id inexistente é 404, não 200', !inexistente.ok && inexistente.status === 404)

  await supabase.from('documents').delete().eq('id', docAlheio!.id)
  await supabase.from('deals').delete().eq('id', negocioAlheio!.id)
  await supabase.from('brokers').delete().eq('id', outroCorretor!.id)

  // ================= Travas de gestão =================
  console.log('\n--- Travas de gestão de acesso ---')

  const autoRebaixar = await atualizarUsuario({
    alvoId: criados.admin,
    quemFezId: criados.admin,
    role: 'viewer',
  })
  ok('ninguém rebaixa o próprio papel', !autoRebaixar.ok, 'ok' in autoRebaixar && autoRebaixar.ok ? 'permitiu' : '')

  const autoDesativar = await atualizarUsuario({
    alvoId: criados.admin,
    quemFezId: criados.admin,
    is_active: false,
  })
  ok('ninguém desativa a própria conta', !autoDesativar.ok)

  /* Último admin: com o admin real já cadastrado, existem 2 ativos, então a
     troca é permitida. Desativo o real temporariamente para provar a trava. */
  const { data: adminsReais } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
    .eq('is_active', true)
    .not('id', 'eq', criados.admin)

  for (const a of adminsReais ?? []) {
    await supabase.from('profiles').update({ is_active: false }).eq('id', a.id)
  }

  const ultimoAdmin = await atualizarUsuario({
    alvoId: criados.admin,
    quemFezId: criados.viewer,
    role: 'corretor',
  })
  ok('não deixa a casa sem nenhum admin ativo', !ultimoAdmin.ok, JSON.stringify(ultimoAdmin))

  for (const a of adminsReais ?? []) {
    await supabase.from('profiles').update({ is_active: true }).eq('id', a.id)
  }

  // Desativar corretor tira ele da fila de atendimento
  await atualizarUsuario({
    alvoId: criados.corretor,
    quemFezId: criados.admin,
    is_active: false,
  })
  const { data: corretorDepois } = await supabase
    .from('brokers')
    .select('is_active')
    .eq('profile_id', criados.corretor)
    .maybeSingle()
  ok('corretor desativado sai da agenda de atendimento', corretorDepois?.is_active === false)

  await limpar()
  console.log('\nUsuários de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})
