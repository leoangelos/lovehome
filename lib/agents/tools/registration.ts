// ==========================================
// Tool de cadastro — request_registration_form.
//
// Gera um link publico tokenizado (PRD 6.5) e devolve para o agente enviar na
// conversa. Nao exige cadastro previo, obviamente — e a tool que existe
// justamente para destravar quem ainda nao tem.
// ==========================================

import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type OpenAI from 'openai'

type Tool = OpenAI.ChatCompletionTool

/** Validade do link. Curto o bastante para um token vazado envelhecer, longo
    o bastante para a pessoa preencher no dia seguinte sem precisar de outro. */
const VALIDADE_HORAS = 72

export const requestRegistrationFormTool: Tool = {
  type: 'function',
  function: {
    name: 'request_registration_form',
    description: `Gera o link do formulário de cadastro e devolve a URL para você enviar na conversa.
Use quando uma ação exigir cadastro completo (agendar visita, reservar imóvel, publicar imóvel,
consultar contrato ou pagamento) e a pessoa ainda não tiver cadastro.
Explique em uma frase por que o cadastro é necessário antes de mandar o link.`,
    parameters: {
      type: 'object',
      properties: {
        form_type: {
          type: 'string',
          enum: ['cadastro', 'listagem_imovel'],
          description:
            'cadastro = identidade (CPF, nome, e-mail, endereço). listagem_imovel = dados e fotos do imóvel do proprietário.',
        },
      },
      required: ['form_type'],
    },
  },
}

export async function handleRequestRegistrationForm(
  contactId: string,
  params: { form_type: 'cadastro' | 'listagem_imovel' }
) {
  const supabase = createAdminClient()

  /* Reaproveita formulario pendente e ainda valido em vez de emitir outro: dois
     links diferentes na mesma conversa e confuso, e o primeiro continuaria
     valido de qualquer forma. */
  const { data: pendente } = await supabase
    .from('form_submissions')
    .select('token, expires_at')
    .eq('contact_id', contactId)
    .eq('form_type', params.form_type)
    .eq('status', 'pendente')
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle()

  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const caminho = params.form_type === 'cadastro' ? 'cadastro' : 'listar-imovel'

  if (pendente) {
    return {
      link: `${base}/${caminho}/${pendente.token}`,
      ja_enviado: true,
      instrucao:
        'Este link já tinha sido enviado e continua válido. Lembre a pessoa dele em vez de tratar como novidade.',
    }
  }

  // 32 bytes de urandom: token de acesso a formulário que coleta CPF não pode
  // ser adivinhável nem derivado do id do contato.
  const token = crypto.randomBytes(32).toString('base64url')
  const expiraEm = new Date(Date.now() + VALIDADE_HORAS * 60 * 60 * 1000).toISOString()

  const { error } = await supabase.from('form_submissions').insert({
    form_type: params.form_type,
    contact_id: contactId,
    token,
    status: 'pendente',
    expires_at: expiraEm,
  })

  if (error) return { erro: error.message }

  // O contato passa a 'pending': o cadastro começou, falta a pessoa preencher.
  await supabase
    .from('contacts')
    .update({ registration_status: 'pending', updated_at: new Date().toISOString() })
    .eq('id', contactId)

  return {
    link: `${base}/${caminho}/${token}`,
    validade_horas: VALIDADE_HORAS,
    instrucao:
      'Envie o link sozinho numa linha, sem colchetes. Diga que leva menos de dois minutos e que você continua por aqui quando terminar.',
  }
}
