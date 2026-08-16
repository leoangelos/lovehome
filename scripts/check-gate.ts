import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { autorizarTool, resolveRegistration } from '../lib/pipeline/resolve-registration'
import type { Contact } from '../lib/types/domain'

/* Exercita o gate deterministico de cadastro (lib/pipeline/resolve-registration.ts)
   contra o banco real. Rodar com: npm run check:gate
   Nao ha framework de teste no projeto — este script e a checagem de regressao
   da peca mais sensivel do pipeline, porque um gate frouxo deixa agendar visita
   e expor extrato de pagamento sem identidade confirmada.

   ESCREVE NO BANCO: corrompe e restaura estado de proposito, para provar que o
   resolver deriva a verdade em vez de confiar no cache. Por isso so toca em
   linhas do seed — contato com telefone fora de 5511900* faz o script abortar
   antes de qualquer update. */

const PREFIXO_DEMO = '5511900'

const supabase = createAdminClient()

function exigirContatoDeSeed(c: Contact) {
  if (!c.phone?.startsWith(PREFIXO_DEMO)) {
    throw new Error(
      `Recusando escrever em contato fora do seed (${c.name ?? c.id}, telefone ${c.phone ?? 'nulo'}). ` +
        `Rode npm run seed antes, e nunca aponte este script para um banco com dado real.`
    )
  }
}

async function contatoPorNome(nome: string): Promise<Contact> {
  const { data, error } = await supabase.from('contacts').select('*').eq('name', nome).single()
  if (error) throw new Error(`${nome}: ${error.message}`)
  return data as Contact
}

function checar(rotulo: string, esperado: unknown, obtido: unknown) {
  const ok = JSON.stringify(esperado) === JSON.stringify(obtido)
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${rotulo}${ok ? '' : ` — esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`}`)
  if (!ok) process.exitCode = 1
}

async function main() {
  // 1. Cadastro completo libera acao de consequencia
  const marina = await contatoPorNome('Marina Coelho')
  const eMarina = await resolveRegistration(marina)
  checar('Marina — status', 'completo', eMarina.status)
  checar('Marina — papeis', ['interessado'], eMarina.roles)
  checar('Marina — create_visit permitido', true, autorizarTool('create_visit', eMarina).permitido)

  // 2. Papeis multiplos, nao exclusivos (PRD 6.4)
  const helena = await contatoPorNome('Helena Prado')
  const eHelena = await resolveRegistration(helena)
  checar('Helena — dois papeis', ['proprietario', 'interessado'].sort(), [...eHelena.roles].sort())

  // 3. Lead sem cadastro: busca livre, acao bloqueada
  const { data: leads } = await supabase
    .from('contacts')
    .select('*')
    .is('registration_id', null)
    .like('phone', `${PREFIXO_DEMO}%`)
    .limit(1)
  const lead = leads![0] as Contact
  exigirContatoDeSeed(lead)
  const eLead = await resolveRegistration(lead)
  checar('Lead sem cadastro — status', 'none', eLead.status)
  checar('Lead — search_properties liberado', true, autorizarTool('search_properties', eLead).permitido)
  checar('Lead — create_visit bloqueado', false, autorizarTool('create_visit', eLead).permitido)
  checar(
    'Lead — get_payment_statement bloqueado',
    false,
    autorizarTool('get_payment_statement', eLead).permitido
  )

  // 4. Cache mentindo: a coluna diz 'completo', o cadastro nao existe.
  //    O gate tem que derivar a verdade e corrigir a coluna.
  await supabase.from('contacts').update({ registration_status: 'completo' }).eq('id', lead.id)
  const leadCorrompido = { ...lead, registration_status: 'completo' as const }
  const eCorrigido = await resolveRegistration(leadCorrompido)
  checar('Cache mentiroso — derivou none', 'none', eCorrigido.status)
  checar('Cache mentiroso — create_visit segue bloqueado', false, autorizarTool('create_visit', eCorrigido).permitido)

  const { data: depois } = await supabase
    .from('contacts')
    .select('registration_status')
    .eq('id', lead.id)
    .single()
  checar('Cache mentiroso — coluna corrigida no banco', 'none', depois!.registration_status)

  // 5. Cadastro pela metade (sem endereco) nao libera acao
  const bianca = await contatoPorNome('Bianca Martins')
  exigirContatoDeSeed(bianca)
  const { data: cadastroBianca } = await supabase
    .from('registrations')
    .select('address')
    .eq('id', bianca.registration_id!)
    .single()

  await supabase.from('registrations').update({ address: null }).eq('id', bianca.registration_id!)
  const eParcial = await resolveRegistration(bianca)
  checar('Cadastro sem endereco — status', 'pending', eParcial.status)
  checar('Cadastro sem endereco — get_lease_status bloqueado', false, autorizarTool('get_lease_status', eParcial).permitido)

  // restaura
  await supabase
    .from('registrations')
    .update({ address: cadastroBianca!.address })
    .eq('id', bianca.registration_id!)
  const eRestaurado = await resolveRegistration(bianca)
  checar('Cadastro restaurado — volta a completo', 'completo', eRestaurado.status)
}

main().catch((e) => {
  console.error('erro:', e.message ?? e)
  process.exit(1)
})
