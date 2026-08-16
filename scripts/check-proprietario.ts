import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { resolveRegistration } from '../lib/pipeline/resolve-registration'
import { runProprietarioAgent } from '../lib/agents/proprietario'
import { validarTokenListagem } from '../lib/imoveis/listagem'
import type { Contact } from '../lib/types/domain'

/* Jornada do proprietário (PRD 4.4, Exemplo 4). Rodar com: npm run check:proprietario
   CHAMA A OPENAI.

   Cobre: conversa -> rascunho -> comparáveis de mercado -> envio -> imóvel em
   análise -> fila de aprovação. E, principalmente, que o imóvel NÃO vai para a
   vitrine sozinho. */

const PREFIXO_DEMO = '5511900'
const supabase = createAdminClient()

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

/* Apaga só o que ESTE teste criou, identificado pelo id.
   A primeira versão apagava tudo que estivesse 'em_analise' no nome da Helena —
   e levou junto o LH-1023 do seed, que é dela. Filtro amplo em rotina de
   limpeza destrói dado vizinho sem avisar. */
const criadosNoTeste: string[] = []

async function limparImoveisDoTeste() {
  for (const id of criadosNoTeste) {
    await supabase.from('approval_requests').delete().eq('property_id', id)
    const { error } = await supabase.from('properties').delete().eq('id', id)
    if (error) throw new Error(`limpeza falhou: ${error.message}`)
  }
  criadosNoTeste.length = 0
}

async function main() {
  // Helena Prado é do seed e tem papel 'proprietario' + cadastro completo.
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('name', 'Helena Prado')
    .single()
  if (error) throw new Error(error.message)

  const helena = data as Contact
  if (!helena.phone?.startsWith(PREFIXO_DEMO)) throw new Error('contato fora do seed')

  await supabase.from('agent_histories').delete().eq('contact_id', helena.id)
  await supabase
    .from('form_submissions')
    .delete()
    .eq('contact_id', helena.id)
    .eq('form_type', 'listagem_imovel')

  const cadastro = await resolveRegistration(helena)
  ok('proprietária com cadastro completo', cadastro.status === 'completo', cadastro.status)
  ok('papel de proprietário reconhecido', cadastro.roles.includes('proprietario'), cadastro.roles.join(', '))

  // ---- Turno 1: abertura ----
  console.log('\n--- "Quero colocar meu apartamento para alugar" ---')
  const r1 = await runProprietarioAgent(
    helena.id,
    'Oi! Tenho um apartamento de 2 quartos na Vila Mariana e quero colocar para alugar.',
    cadastro
  )
  console.log(`\n> ${r1.content}\n`)
  console.log(`tools: ${r1.toolsUsed.join(', ') || 'nenhuma'}`)

  ok('salvou rascunho do imóvel', r1.toolsUsed.includes('save_property_draft'))
  ok('consultou comparáveis de mercado', r1.toolsUsed.includes('get_market_comparables'))

  const comparaveis = r1.trace?.toolCalls?.find((t) => t.name === 'get_market_comparables')
  const resultado = comparaveis?.result as { encontrado?: boolean; preco_mediano?: string }
  if (resultado?.encontrado) {
    console.log(`INFO  faixa de referência: mediana ${resultado.preco_mediano}`)
    ok(
      'apresentou faixa de preço na conversa',
      /R\$|entre|valor|preço/i.test(r1.content),
      'não citou preço nenhum'
    )
  } else {
    console.log('INFO  amostra pequena — agente não deve sugerir número')
    ok(
      'com amostra pequena, não inventou preço',
      !/R\$\s?\d/.test(r1.content) || /corretor|avaliar|poucos/i.test(r1.content)
    )
  }

  const { data: rascunho } = await supabase
    .from('form_submissions')
    .select('token, payload')
    .eq('contact_id', helena.id)
    .eq('form_type', 'listagem_imovel')
    .maybeSingle()

  ok('rascunho criado com token de formulário', Boolean(rascunho?.token))
  const dados = (rascunho?.payload ?? {}) as Record<string, unknown>
  console.log(`INFO  rascunho: ${JSON.stringify(dados)}`)
  ok('rascunho guardou a região', dados.region === 'Vila Mariana' || /vila mariana/i.test(String(dados.region)))

  // ---- Turno 2: completa e confirma ----
  console.log('\n--- "70m², 1 vaga, condomínio 600. Pode enviar." ---')
  const r2 = await runProprietarioAgent(
    helena.id,
    'São 70m², tem 1 vaga e o condomínio é 600 reais. Quero pedir 3.200 de aluguel. Pode enviar para análise, os dados estão certos.',
    cadastro
  )
  console.log(`\n> ${r2.content}\n`)
  console.log(`tools: ${r2.toolsUsed.join(', ') || 'nenhuma'}`)

  ok('enviou o imóvel para análise', r2.toolsUsed.includes('submit_property_listing'))

  const { data: imovel } = await supabase
    .from('properties')
    .select('id, reference_code, status, region, rent_price_cents, area_m2, photos, owner_registration_id')
    .eq('owner_registration_id', helena.registration_id!)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  ok('imóvel foi criado', Boolean(imovel), imovel?.reference_code ?? '')
  if (imovel) criadosNoTeste.push(imovel.id)

  if (imovel) {
    /* O ponto central do Exemplo 4: imóvel de proprietário NÃO entra na vitrine
       sozinho. Se este teste falhar, qualquer um publica o que quiser. */
    ok('nasceu EM ANÁLISE, não disponível', imovel.status === 'em_analise', imovel.status)
    ok('vinculado ao cadastro da proprietária', imovel.owner_registration_id === helena.registration_id)
    console.log(
      `INFO  ${imovel.reference_code}: ${imovel.region} · ${imovel.area_m2}m² · aluguel ${imovel.rent_price_cents} centavos`
    )

    const { data: aprovacao } = await supabase
      .from('approval_requests')
      .select('type, status')
      .eq('property_id', imovel.id)
      .maybeSingle()

    ok('entrou na fila de aprovação', aprovacao?.status === 'pendente')
    ok('com o tipo certo', aprovacao?.type === 'aprovacao_listagem_imovel', aprovacao?.type ?? '')

    // ---- Vitrine não enxerga ----
    const { count: naVitrine } = await supabase
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('id', imovel.id)
      .eq('status', 'disponivel')
    ok('não aparece na vitrine antes de aprovar', naVitrine === 0)

    /* Sem foto o imóvel ainda pode ser publicado — a tela avisa e quem revisa
       decide. Aqui só registramos o estado para o INFO fazer sentido. */
    const fotos = (imovel.photos as string[] | null) ?? []
    console.log(`INFO  fotos no envio por chat: ${fotos.length}`)
  }

  // ---- Formulário de listagem ----
  if (rascunho?.token) {
    const tk = await validarTokenListagem(rascunho.token)
    /* Depois do submit o rascunho vira 'preenchido', então o link deixa de
       abrir — é o comportamento certo: o imóvel já foi enviado. */
    ok(
      'link de listagem fecha depois do envio',
      !tk.valido && tk.motivo === 'ja_preenchido',
      tk.valido ? 'continua aberto' : tk.motivo
    )
  }

  await limparImoveisDoTeste()
  await supabase.from('agent_histories').delete().eq('contact_id', helena.id)
  console.log('\nImóveis de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limparImoveisDoTeste().catch(() => {})
  process.exit(1)
})
