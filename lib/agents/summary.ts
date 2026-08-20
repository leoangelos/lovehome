// ==========================================
// Gerador de resumo para o corretor — requisito explicito do hackathon.
//
// Le o historico do agente ativo diretamente de agent_histories (por isso a
// decisao de nao usar a Assistants API: o historico precisa ser legivel por
// fora da conversa, PRD 7.2) e produz um resumo estruturado que o corretor
// consegue ler em vinte segundos antes de ligar.
//
// Grava SEMPRE em lead_summaries, mesmo que o envio por WhatsApp falhe: o
// painel e a garantia de que o corretor recebe o contexto (risco mapeado na
// secao 22 do PRD).
// ==========================================

import { openai } from '@/lib/openai/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { agoraDescrito, dataHoraLocal, descreverQuando } from '@/lib/agenda/fuso'
import { brl } from '@/lib/utils/format'
import type { ChatHistoryMessage } from '@/lib/types/agents'
import { registrarUso } from '@/lib/observabilidade/uso'

export type SummaryTrigger =
  | 'qualificacao_completa'
  | 'visita_agendada'
  | 'reengajamento'
  | 'manual'

const PROMPT = `Você prepara o briefing que um corretor lê antes de ligar para um lead.
Ele tem vinte segundos. Escreva em português, direto, sem saudação e sem despedida.

Formato exato, nesta ordem:

O que procura: uma frase.
Situação: em que ponto está a conversa e o que já foi feito.
Próximo passo: a ação concreta que o corretor deve tomar.
Atenção: só inclua esta linha se houver algo que mude a abordagem (urgência declarada,
restrição de orçamento, objeção levantada, preferência forte). Se não houver, omita a linha.

Regras:
- Só afirme o que está no histórico. Não deduza renda, estado civil ou intenção não dita.
- Se um dado importante não apareceu na conversa, diga "não informado" em vez de inventar.
- Sem bullet points, sem markdown, sem asteriscos.
- DATAS: o corretor lê este briefing depois, às vezes dias depois. NUNCA escreva "hoje",
  "amanhã" ou "semana que vem": o contexto diz que dia é agora e descreve as visitas com a
  relação já calculada — copie essas descrições ou escreva a data absoluta (ex.: "terça,
  18/08 às 10h"). Um "amanhã" do histórico é relativo ao dia em que foi dito, não a hoje.`

export async function generateLeadSummary(params: {
  contactId: string
  trigger: SummaryTrigger
}): Promise<{ gerado: boolean; resumoId?: string; motivo?: string }> {
  const supabase = createAdminClient()
  const { contactId, trigger } = params

  const [{ data: contato }, { data: qualificacao }, { data: historicos }, { data: visitas }] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, name, phone, funnel_stage, intent, active_agent, assigned_broker_id, registration_status')
      .eq('id', contactId)
      .single(),
    supabase.from('lead_qualifications').select('*').eq('contact_id', contactId).maybeSingle(),
    supabase
      .from('agent_histories')
      .select('agent, messages, updated_at')
      .eq('contact_id', contactId)
      .order('updated_at', { ascending: false }),
    supabase
      .from('property_visits')
      .select('scheduled_at, status, properties ( reference_code, region )')
      .eq('contact_id', contactId)
      .gte('scheduled_at', new Date(Date.now() - 30 * 86400_000).toISOString())
      .order('scheduled_at', { ascending: false })
      .limit(3),
  ])

  if (!contato) return { gerado: false, motivo: 'contato não encontrado' }

  // Junta o histórico de todos os agentes por onde a pessoa passou, do mais
  // recente para trás — o SDR pode ter qualificado e o Agendamento concluído.
  const turnos: string[] = []
  for (const h of historicos ?? []) {
    const msgs = (h.messages as ChatHistoryMessage[]) ?? []
    for (const m of msgs.slice(-20)) {
      const carimbo = m.created_at ? `[${dataHoraLocal(new Date(m.created_at))}] ` : ''
      turnos.push(`${carimbo}${m.role === 'user' ? 'Cliente' : `Agente(${h.agent})`}: ${m.content}`)
    }
  }

  if (turnos.length === 0) {
    return { gerado: false, motivo: 'sem histórico de conversa para resumir' }
  }

  /* Visitas vêm do BANCO, não do texto: o histórico diz "amanhã às 10h" de um
     amanhã que já passou; a tabela diz a data real, e descreverQuando entrega a
     relação com hoje já calculada. */
  const linhasVisita = (visitas ?? []).map((v) => {
    const imovel = v.properties as unknown as { reference_code: string; region: string | null } | null
    return `Visita ${v.status}: ${imovel?.reference_code ?? 'imóvel'}${imovel?.region ? ` (${imovel.region})` : ''} — ${descreverQuando(new Date(v.scheduled_at))}`
  })

  const perfil = [
    `AGORA é ${agoraDescrito()} (horário de São Paulo)`,
    ...linhasVisita,
    `Nome: ${contato.name ?? 'não informado'}`,
    `Estágio: ${contato.funnel_stage}`,
    `Intenção: ${contato.intent ?? 'não identificada'}`,
    qualificacao?.region ? `Região: ${qualificacao.region}` : null,
    qualificacao?.property_type ? `Tipo: ${qualificacao.property_type}` : null,
    qualificacao?.bedrooms ? `Dormitórios: ${qualificacao.bedrooms}` : null,
    qualificacao?.price_max_cents
      ? `Orçamento até: ${brl(qualificacao.price_max_cents)}`
      : null,
    qualificacao?.investor_ticket_cents
      ? `Ticket de investimento: ${brl(qualificacao.investor_ticket_cents)}`
      : null,
    qualificacao?.urgency ? `Urgência: ${qualificacao.urgency}` : null,
    qualificacao?.notes ? `Notas: ${qualificacao.notes}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const resposta = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: PROMPT },
      {
        role: 'user',
        content: `Dados do lead:\n${perfil}\n\nConversa (mais recente por último):\n${turnos.slice(-40).join('\n')}`,
      },
    ],
  })

  await registrarUso({
    operacao: 'resumo',
    modelo: 'gpt-4o-mini',
    tokensEntrada: resposta.usage?.prompt_tokens,
    tokensSaida: resposta.usage?.completion_tokens,
    detalhe: {
      resumo: 'Gerou o resumo do lead para o corretor',
      entradas: [
        { rotulo: 'Turnos resumidos', valor: String(Math.min(turnos.length, 40)) },
        { rotulo: 'Perfil do lead', valor: `${perfil.length} caracteres` },
      ],
    },
  })

  const texto = resposta.choices[0].message.content?.trim()
  if (!texto) return { gerado: false, motivo: 'modelo não retornou texto' }

  const { data: resumo, error } = await supabase
    .from('lead_summaries')
    .insert({
      contact_id: contactId,
      broker_id: contato.assigned_broker_id,
      trigger,
      summary_text: texto,
      structured_data: {
        funnel_stage: contato.funnel_stage,
        intent: contato.intent,
        registration_status: contato.registration_status,
        qualificacao: qualificacao ?? null,
      },
      sent_via: 'dashboard',
      sent_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) return { gerado: false, motivo: error.message }

  return { gerado: true, resumoId: resumo.id }
}
