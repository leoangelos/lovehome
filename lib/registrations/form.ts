// ==========================================
// Submissao do formulario publico de cadastro (PRD 6.5).
//
// Rota publica que coleta CPF. Tudo aqui e server-side, e o token do link e a
// unica credencial — por isso ele e aleatorio de 32 bytes, tem validade e vira
// 'preenchido' ao ser usado.
//
// NADA nesta camada loga CPF. Para depurar, use cpf_last4.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { cpfValido, hashCpf, prepararCpf } from '@/lib/registrations/cpf'
import { listarCamposAtivos } from '@/lib/registrations/campos'
import { validarRespostas, type CampoFormulario } from '@/lib/registrations/campos-formato'
import type { ContactRole } from '@/lib/types/domain'

export interface TokenValido {
  valido: true
  formSubmissionId: string
  contactId: string | null
  formType: 'cadastro' | 'listagem_imovel'
  nomeSugerido: string | null
  /** Perguntas configuradas no painel (PRD 6.5). Vazio = formulário padrão. */
  campos: CampoFormulario[]
}

export interface TokenInvalido {
  valido: false
  motivo: 'inexistente' | 'expirado' | 'ja_preenchido'
}

export async function validarToken(token: string): Promise<TokenValido | TokenInvalido> {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('form_submissions')
    .select('id, contact_id, form_type, status, expires_at, contacts ( name )')
    .eq('token', token)
    .maybeSingle()

  if (!data) return { valido: false, motivo: 'inexistente' }
  if (data.status === 'preenchido') return { valido: false, motivo: 'ja_preenchido' }
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    // Marca como expirado para a tela de /formularios do painel mostrar o
    // motivo real, em vez de um pendente eterno.
    await supabase.from('form_submissions').update({ status: 'expirado' }).eq('id', data.id)
    return { valido: false, motivo: 'expirado' }
  }

  const contato = data.contacts as unknown as { name: string | null } | null

  return {
    valido: true,
    formSubmissionId: data.id,
    contactId: data.contact_id,
    formType: data.form_type,
    nomeSugerido: contato?.name ?? null,
    campos: await listarCamposAtivos(data.form_type),
  }
}

export interface DadosCadastro {
  cpf: string
  full_name: string
  email: string
  birth_date?: string
  address: {
    street: string
    number: string
    complement?: string
    neighborhood: string
    city: string
    state: string
    zip: string
  }
  roles: ContactRole[]
  /** Respostas dos campos configuráveis, por chave. */
  extra?: Record<string, unknown>
}

export type ResultadoSubmissao =
  | { ok: true; registrationId: string }
  | { ok: false; erro: string; campo?: string }
  | { ok: 'revisao'; mensagem: string }

export async function submeterCadastro(
  token: string,
  dados: DadosCadastro
): Promise<ResultadoSubmissao> {
  const supabase = createAdminClient()

  const tk = await validarToken(token)
  if (!tk.valido) {
    const motivos = {
      inexistente: 'Link inválido.',
      expirado: 'Este link expirou. Peça um novo na conversa.',
      ja_preenchido: 'Este cadastro já foi preenchido.',
    }
    return { ok: false, erro: motivos[tk.motivo] }
  }

  // ---- Validação ----
  if (!cpfValido(dados.cpf)) return { ok: false, erro: 'CPF inválido.', campo: 'cpf' }
  if (!dados.full_name?.trim() || !dados.full_name.trim().includes(' ')) {
    return { ok: false, erro: 'Informe o nome completo.', campo: 'full_name' }
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dados.email ?? '')) {
    return { ok: false, erro: 'E-mail inválido.', campo: 'email' }
  }
  if (!dados.roles?.length) {
    return { ok: false, erro: 'Escolha ao menos uma opção.', campo: 'roles' }
  }
  const camposEndereco: (keyof DadosCadastro['address'])[] = [
    'street',
    'number',
    'neighborhood',
    'city',
    'state',
    'zip',
  ]
  for (const campo of camposEndereco) {
    if (!String(dados.address?.[campo] ?? '').trim()) {
      return { ok: false, erro: 'Preencha o endereço completo.', campo: `address.${campo}` }
    }
  }

  /* ---- Campos configuráveis (PRD 6.5) ----
     `limpas` descarta qualquer chave que não corresponda a um campo ativo e
     visível. Copiar `dados.extra` direto guardaria, dentro do cadastro e para
     sempre, o que alguém inventasse no devtools. */
  const { erros: errosExtra, limpas: extra } = validarRespostas(
    tk.campos,
    dados.extra ?? {},
    dados.roles
  )
  if (errosExtra.length) {
    return { ok: false, erro: errosExtra[0].mensagem, campo: `extra.${errosExtra[0].chave}` }
  }

  /* ---- CPF já cadastrado ----
     Vincular automaticamente seria o caminho cômodo e é o errado.
     O token do formulário está preso a um contato de WhatsApp, e CPF de
     terceiro é fácil de obter no Brasil. Auto-vincular deixaria qualquer um
     conversar com o bot, receber um link, digitar o CPF de outra pessoa e
     passar a consultar contrato e boleto dela pelo agente Suporte.
     Então: grava a submissão, mantém o contato SEM vínculo e manda para
     conferência humana. Custa atrito no caso legítimo (mesma pessoa, número
     novo) e fecha a porta no caso hostil. */
  const hash = hashCpf(dados.cpf)
  const { data: existente } = await supabase
    .from('registrations')
    .select('id')
    .eq('cpf_hash', hash)
    .maybeSingle()

  if (existente) {
    await supabase
      .from('form_submissions')
      .update({
        status: 'preenchido',
        submitted_at: new Date().toISOString(),
        payload: {
          motivo_revisao: 'cpf_ja_cadastrado',
          full_name: dados.full_name,
          email: dados.email,
          roles: dados.roles,
          // As respostas dos campos configuraveis vao junto: descartar aqui
          // faria a pessoa responder tudo de novo se a conferencia recusar o
          // vinculo e ela precisar refazer o cadastro.
          extra,
          // Sem CPF no payload — nem em claro, nem hash. O ponteiro para o
          // cadastro existente é o que a tela de conferência usa para pôr os
          // dois lados lado a lado; sem ele o revisor não teria como julgar se
          // é a mesma pessoa, e a fila viraria um monte de casos insolúveis.
          registration_id_conflito: existente.id,
        },
      })
      .eq('id', tk.formSubmissionId)

    console.log(
      `[cadastro] submissão ${tk.formSubmissionId} retida para conferência: CPF já cadastrado`
    )

    return {
      ok: 'revisao',
      mensagem:
        'Recebemos seus dados. Como já existe um cadastro com esse CPF, um corretor vai confirmar com você antes de liberar. Você recebe um retorno pelo WhatsApp.',
    }
  }

  // ---- Cadastro novo ----
  const { data: novo, error: erroCadastro } = await supabase
    .from('registrations')
    .insert({
      ...prepararCpf(dados.cpf),
      full_name: dados.full_name.trim(),
      email: dados.email.trim().toLowerCase(),
      birth_date: dados.birth_date || null,
      address: dados.address,
      extra,
    })
    .select('id')
    .single()

  if (erroCadastro || !novo) {
    return { ok: false, erro: 'Não foi possível salvar o cadastro. Tente novamente.' }
  }

  // Papéis múltiplos, não exclusivos (PRD 6.4)
  const papeisUnicos = [...new Set(dados.roles)]
  await supabase
    .from('contact_roles')
    .insert(papeisUnicos.map((role) => ({ registration_id: novo.id, role })))

  if (tk.contactId) {
    await supabase
      .from('contacts')
      .update({
        registration_id: novo.id,
        registration_status: 'completo',
        name: dados.full_name.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', tk.contactId)
  }

  await supabase
    .from('form_submissions')
    .update({
      status: 'preenchido',
      registration_id: novo.id,
      submitted_at: new Date().toISOString(),
      payload: { roles: papeisUnicos, extra },
    })
    .eq('id', tk.formSubmissionId)

  return { ok: true, registrationId: novo.id }
}
