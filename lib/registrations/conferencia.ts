// ==========================================
// Decisão humana sobre submissão retida por CPF já cadastrado (PRD 6.5).
//
// Vincular um contato a um cadastro existente dá àquele número de WhatsApp
// acesso, pelo agente Suporte, ao contrato e ao boleto do titular. É exatamente
// o que `submeterCadastro` se recusa a fazer sozinho — e por isso mora aqui,
// fora da rota HTTP: é a regra que precisa ser testável sem subir sessão.
//
// Nada nesta camada lê cpf_hash ou cpf_encrypted.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { notificarCrm } from '@/lib/crm/webhook'

export type AcaoConferencia = 'vincular' | 'recusar'

export type ResultadoConferencia =
  | { ok: true; registrationId?: string }
  | { ok: false; erro: string; status: number }

interface PayloadRevisao {
  motivo_revisao?: string
  roles?: string[]
  registration_id_conflito?: string
  revisao_decisao?: string
}

export async function decidirConferencia(params: {
  submissaoId: string
  acao: AcaoConferencia
  motivo?: string
  decididoPor: string
}): Promise<ResultadoConferencia> {
  const { submissaoId, acao, decididoPor } = params
  const motivo = params.motivo?.trim()

  if (acao === 'recusar' && !motivo) {
    return {
      ok: false,
      erro: 'Diga por que não é a mesma pessoa — fica no histórico da submissão.',
      status: 400,
    }
  }

  const supabase = createAdminClient()

  const { data: submissao } = await supabase
    .from('form_submissions')
    .select('id, contact_id, payload')
    .eq('id', submissaoId)
    .maybeSingle()

  if (!submissao) return { ok: false, erro: 'Submissão não encontrada.', status: 404 }

  const payload = (submissao.payload ?? {}) as PayloadRevisao

  if (payload.motivo_revisao !== 'cpf_ja_cadastrado') {
    return { ok: false, erro: 'Esta submissão não está em conferência.', status: 400 }
  }

  /* Decisão já tomada: recusar a segunda em vez de sobrescrever. Duas abas
     abertas na mesma fila é o caso comum, e "vincular" aplicado por cima
     esconderia que alguém já tinha recusado. */
  if (payload.revisao_decisao) {
    return { ok: false, erro: 'Esta submissão já foi decidida. Recarregue a fila.', status: 409 }
  }

  const decisao = {
    revisao_decisao: acao === 'vincular' ? 'vinculado' : 'recusado',
    revisao_por: decididoPor,
    revisao_em: new Date().toISOString(),
    revisao_motivo: motivo ?? null,
  }

  if (acao === 'recusar') {
    const { error } = await supabase
      .from('form_submissions')
      .update({ payload: { ...payload, ...decisao } })
      .eq('id', submissaoId)

    if (error) return { ok: false, erro: 'Não foi possível salvar.', status: 500 }

    console.log(`[formularios] ${decididoPor} recusou o vínculo da submissão ${submissaoId}`)
    return { ok: true }
  }

  // ---- Vincular ----
  const cadastroId = payload.registration_id_conflito
  if (!cadastroId) {
    return {
      ok: false,
      erro: 'Esta submissão não registrou qual cadastro conflitou. Vincule pela tela de leads.',
      status: 422,
    }
  }

  const { data: cadastro } = await supabase
    .from('registrations')
    .select('id')
    .eq('id', cadastroId)
    .maybeSingle()

  if (!cadastro) return { ok: false, erro: 'O cadastro em conflito não existe mais.', status: 404 }

  if (!submissao.contact_id) {
    return {
      ok: false,
      erro: 'Esta submissão não veio de uma conversa — não há contato para vincular.',
      status: 422,
    }
  }

  const { data: contato } = await supabase
    .from('contacts')
    .select('id, registration_id')
    .eq('id', submissao.contact_id)
    .maybeSingle()

  if (!contato) return { ok: false, erro: 'O contato não existe mais.', status: 404 }

  /* Contato já vinculado a OUTRO cadastro: recusar. Trocar o titular de um
     número por baixo do pano é pior do que não fazer nada — quem estivesse
     usando aquele WhatsApp perderia o próprio histórico e ganharia o de outra
     pessoa. */
  if (contato.registration_id && contato.registration_id !== cadastroId) {
    return {
      ok: false,
      erro: 'Este contato já está vinculado a outro cadastro. Resolva pela tela de leads.',
      status: 409,
    }
  }

  const { error: erroContato } = await supabase
    .from('contacts')
    .update({
      registration_id: cadastroId,
      registration_status: 'completo',
      updated_at: new Date().toISOString(),
    })
    .eq('id', contato.id)

  if (erroContato) return { ok: false, erro: 'Não foi possível vincular.', status: 500 }

  // Vincular também é "cadastro completo" para o CRM: o lead ganhou identidade formal.
  await notificarCrm('lead_cadastro_completo', contato.id)

  /* Papéis que a pessoa declarou agora e o cadastro antigo não tinha. Quem se
     cadastrou como interessado e voltou como proprietário precisa dos dois —
     `contact_roles` já é múltiplo por decisão da §6.4. */
  const declarados = [...new Set(payload.roles ?? [])]
  if (declarados.length) {
    const { data: atuais } = await supabase
      .from('contact_roles')
      .select('role')
      .eq('registration_id', cadastroId)

    const tem = new Set((atuais ?? []).map((r) => r.role))
    const faltando = declarados.filter((r) => !tem.has(r))
    if (faltando.length) {
      await supabase
        .from('contact_roles')
        .insert(faltando.map((role) => ({ registration_id: cadastroId, role })))
    }
  }

  const { error: erroSubmissao } = await supabase
    .from('form_submissions')
    .update({ registration_id: cadastroId, payload: { ...payload, ...decisao } })
    .eq('id', submissaoId)

  if (erroSubmissao) {
    return {
      ok: false,
      erro: 'O contato foi vinculado, mas a submissão não fechou. Recarregue a fila.',
      status: 500,
    }
  }

  console.log(`[formularios] ${decididoPor} vinculou o contato ${contato.id} ao cadastro ${cadastroId}`)
  return { ok: true, registrationId: cadastroId }
}
