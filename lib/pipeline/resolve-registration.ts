// ==========================================
// Resolucao de cadastro — passo deterministico do pipeline (PRD 6.3).
//
// Roda ao lado do dedup e da identidade multi-canal, ANTES de o orquestrador
// rotear, e entrega `registration_status` e `roles` prontos como sinal.
//
// Por que nao deixar isso para o LLM: acao de consequencia real — agendar
// visita, reservar unidade, publicar imovel no nome de alguem, expor extrato de
// pagamento — nao pode depender de o modelo "lembrar" de checar identidade. O
// orquestrador escolhe o agente pelo conteudo da conversa; quem decide se a
// acao pode prosseguir e este arquivo.
//
// E o inverso tambem importa: conversar e buscar imovel NAO exigem cadastro.
// Pedir CPF antes da primeira busca e a friccao que mata justamente o problema
// que o produto resolve (PRD 6.3, e o Exemplo 1 do proprio hackathon mostra o
// lead pesquisando sem fornecer documento nenhum).
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import type { Contact, ContactRole, RegistrationStatus } from '@/lib/types/domain'

export interface EstadoCadastro {
  status: RegistrationStatus
  registrationId: string | null
  roles: ContactRole[]
  /** Nome do cadastro formal, quando existe — util para o agente tratar a pessoa pelo nome certo */
  nomeCompleto: string | null
}

/**
 * Acoes que exigem `registration_status = 'completo'`.
 *
 * A chave e o nome da tool, nao o nome do agente: o gate intercepta a ACAO.
 * Um agente pode conversar livremente e so esbarrar no cadastro no momento de
 * confirmar o horario — que e exatamente o comportamento descrito no Exemplo 1.
 */
export const TOOLS_QUE_EXIGEM_CADASTRO = new Set([
  // Agendamento
  'create_visit',
  // Closer
  'create_deal',
  'request_documents',
  'confirm_document_received',
  // Proprietario — publicar imovel em nome de alguem exige identidade confirmada
  'submit_property_listing',
  // Suporte — autoatendimento de dado pessoal, aqui nao ha excecao
  'get_payment_statement',
  'get_lease_status',
  'request_lease_termination',
])

/** Tools explicitamente liberadas sem cadastro — documentadas para nao virarem dúvida. */
export const TOOLS_SEM_CADASTRO = new Set([
  'search_properties',
  'get_market_comparables',
  'save_qualification',
  'save_property_draft',
  'request_registration_form',
  'transfer_to_agendamento',
  'transfer_to_investidor',
  'transfer_to_broker',
  'escalate_to_human',
])

export function exigeCadastro(toolName: string): boolean {
  return TOOLS_QUE_EXIGEM_CADASTRO.has(toolName)
}

/**
 * Recalcula o estado de cadastro do contato a partir do banco.
 *
 * `contacts.registration_status` e cache denormalizado, existe para o
 * orquestrador ler sem join. A verdade e o registro em si — por isso aqui o
 * valor e sempre derivado e, se tiver divergido, corrigido na hora. Confiar na
 * coluna sem conferir e o caminho para alguem agendar visita porque um update
 * antigo deixou 'completo' num contato cujo cadastro foi apagado depois.
 */
export async function resolveRegistration(contact: Contact): Promise<EstadoCadastro> {
  const supabase = createAdminClient()

  let estado: EstadoCadastro = {
    status: 'none',
    registrationId: null,
    roles: [],
    nomeCompleto: null,
  }

  if (contact.registration_id) {
    const { data: cadastro } = await supabase
      .from('registrations')
      .select('id, full_name, email, address, cpf_hash')
      .eq('id', contact.registration_id)
      .maybeSingle()

    if (cadastro) {
      const { data: papeis } = await supabase
        .from('contact_roles')
        .select('role')
        .eq('registration_id', cadastro.id)

      const roles = (papeis ?? []).map((p) => p.role as ContactRole)

      /* "Completo" e o que o formulario de cadastro (PRD 6.5) coleta: CPF,
         nome, e-mail, endereco e ao menos um papel. Cadastro criado pela metade
         — por exemplo, o agente resolveu o CPF mas a pessoa abandonou o
         formulario — nao libera acao de consequencia. */
      const completo =
        Boolean(cadastro.cpf_hash) &&
        Boolean(cadastro.full_name) &&
        Boolean(cadastro.email) &&
        Boolean(cadastro.address) &&
        roles.length > 0

      estado = {
        status: completo ? 'completo' : 'pending',
        registrationId: cadastro.id,
        roles,
        nomeCompleto: cadastro.full_name ?? null,
      }
    }
  }

  // Sem cadastro vinculado: 'pending' se ja existe formulario aberto esperando
  // a pessoa preencher — assim o agente sabe que deve cobrar o link enviado em
  // vez de mandar outro.
  if (estado.status === 'none') {
    const { data: formulario } = await supabase
      .from('form_submissions')
      .select('id')
      .eq('contact_id', contact.id)
      .eq('form_type', 'cadastro')
      .eq('status', 'pendente')
      .limit(1)
      .maybeSingle()

    if (formulario) estado.status = 'pending'
  }

  // Corrige o cache quando divergiu.
  if (estado.status !== contact.registration_status) {
    await supabase
      .from('contacts')
      .update({
        registration_status: estado.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contact.id)

    console.log(
      `[resolveRegistration] cache corrigido para ${contact.id}: ` +
        `${contact.registration_status} -> ${estado.status}`
    )
  }

  return estado
}

export interface ResultadoGate {
  permitido: boolean
  /** Preenchido quando bloqueado — o agente deve pedir o cadastro antes de tentar de novo. */
  motivo?: string
}

/**
 * Decide se uma tool pode executar dado o estado de cadastro.
 * Chamado no despacho de tool, nao no prompt: se o modelo tentar `create_visit`
 * sem cadastro, a chamada e barrada aqui e ele recebe a instrucao de pedir o
 * formulario.
 */
export function autorizarTool(toolName: string, estado: EstadoCadastro): ResultadoGate {
  if (!exigeCadastro(toolName)) return { permitido: true }

  if (estado.status === 'completo') return { permitido: true }

  return {
    permitido: false,
    motivo:
      estado.status === 'pending'
        ? 'O cadastro foi iniciado mas ainda não foi concluído. Retome o link do formulário já enviado antes de seguir com esta ação.'
        : 'Esta ação exige cadastro completo. Chame request_registration_form e aguarde a pessoa preencher antes de tentar de novo.',
  }
}
