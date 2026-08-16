// ==========================================
// Cliente do Asaas a partir de um cadastro (PRD 14.3).
//
// ATENÇÃO — ESTE É O SEGUNDO E ÚLTIMO LUGAR DO SISTEMA QUE DESCRIPTOGRAFA CPF.
//
// O outro é lib/leasing/contract-template.ts, porque contrato é documento legal
// e precisa do número inteiro. Aqui é porque criar cliente no Asaas exige
// `cpfCnpj`: cobrança no Brasil pede documento por lei, e não existe caminho
// que contorne isso.
//
// O que impede a exceção de virar rotina: o id devolvido pelo Asaas fica em
// `registrations.asaas_customer_id`. Da segunda cobrança em diante o sistema só
// usa o id, e o CPF nunca mais é aberto. Se algum dia aparecer um terceiro
// lugar chamando decryptSecret, é bug até prova em contrário.
//
// Nada aqui loga CPF. Para depurar, use cpf_last4 ou o asaas_customer_id.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/crypto/encrypt'
import { chamarAsaas } from './client'

export type ResultadoCliente =
  | { ok: true; customerId: string; criado: boolean }
  | { ok: false; erro: string }

interface ClienteAsaas {
  id: string
  name: string
  cpfCnpj: string
}

/**
 * Devolve o `asaas_customer_id` do cadastro, criando o cliente se ainda não
 * existir. Idempotente: chamar duas vezes não cria dois clientes.
 */
export async function garantirClienteAsaas(registrationId: string): Promise<ResultadoCliente> {
  const supabase = createAdminClient()

  const { data: cadastro } = await supabase
    .from('registrations')
    .select('id, full_name, email, cpf_encrypted, cpf_last4, address, asaas_customer_id')
    .eq('id', registrationId)
    .maybeSingle()

  if (!cadastro) return { ok: false, erro: 'Cadastro não encontrado.' }

  // Já existe: nem lê o CPF cifrado.
  if (cadastro.asaas_customer_id) {
    return { ok: true, customerId: cadastro.asaas_customer_id, criado: false }
  }

  let cpf: string
  try {
    cpf = decryptSecret(cadastro.cpf_encrypted)
  } catch (e) {
    /* Falha aqui normalmente é APP_ENCRYPTION_KEY trocada — o CPF virou ilegível
       e nenhuma cobrança vai sair. Dizer isso é melhor do que "erro ao criar
       cliente", que manda a pessoa procurar no lugar errado. */
    console.error('[asaas] não foi possível ler o CPF do cadastro', cadastro.id, (e as Error).message)
    return { ok: false, erro: 'Não foi possível ler o CPF deste cadastro.' }
  }

  const endereco = (cadastro.address ?? {}) as Record<string, string>

  const r = await chamarAsaas<ClienteAsaas>('/customers', {
    method: 'POST',
    body: {
      name: cadastro.full_name,
      cpfCnpj: cpf,
      email: cadastro.email ?? undefined,
      postalCode: endereco.zip?.replace(/\D/g, '') || undefined,
      address: endereco.street || undefined,
      addressNumber: endereco.number || undefined,
      complement: endereco.complement || undefined,
      province: endereco.neighborhood || undefined,
      /* `externalReference` amarra o cliente do Asaas ao cadastro daqui — é o
         que permite conciliar quando alguém mexe direto no painel deles. */
      externalReference: cadastro.id,
      notificationDisabled: false,
    },
  })

  if (!r.ok || !r.dados?.id) {
    return { ok: false, erro: r.erro ?? 'O Asaas não devolveu o cliente.' }
  }

  const { error } = await supabase
    .from('registrations')
    .update({ asaas_customer_id: r.dados.id, updated_at: new Date().toISOString() })
    .eq('id', cadastro.id)

  if (error) {
    /* O cliente existe no Asaas mas não conseguimos guardar o id: a próxima
       tentativa criaria um duplicado. Melhor falhar alto do que deixar dois
       clientes para a mesma pessoa. */
    console.error('[asaas] cliente criado mas não gravado:', r.dados.id, error.message)
    return { ok: false, erro: 'Cliente criado no Asaas, mas não foi possível vinculá-lo. Tente de novo.' }
  }

  console.log(`[asaas] cliente ${r.dados.id} criado para o cadastro ${cadastro.id}`)
  return { ok: true, customerId: r.dados.id, criado: true }
}

/** Usado só pela limpeza do teste — o painel não apaga cliente. */
export async function removerClienteAsaas(customerId: string): Promise<boolean> {
  const r = await chamarAsaas(`/customers/${customerId}`, { method: 'DELETE' })
  return r.ok
}
