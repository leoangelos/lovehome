// ==========================================
// Registro de uso e custo de LLM.
//
// UM helper para os 13 pontos que chamam a OpenAI. Antes disto, só os tokens do
// agente eram gravados — orquestrador, embeddings, Whisper, Vision, copiloto,
// resumo e follow-up não apareciam em lugar nenhum. Um painel de custo montado
// sobre o que existia mostraria a maior parte do gasto e pareceria completo,
// que é a forma mais cara de errar um número.
//
// REGRA: registrar uso NUNCA pode derrubar a operação que o gerou. Uma falha ao
// gravar a linha de custo não vale uma conversa perdida. Tudo aqui engole erro
// e loga.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'

export { ROTULO_OPERACAO, type OperacaoLLM } from '@/lib/ui/rotulos'
import type { OperacaoLLM } from '@/lib/ui/rotulos'

/* ==========================================================================
   Tabela de preços — ESTIMATIVA, em dólar por 1 milhão de tokens.

   Isto vai ficar desatualizado: a OpenAI muda preço e o número aqui não se
   corrige sozinho. O painel diz "estimado" em toda tela por causa disso, e este
   é o único lugar a mexer quando o preço mudar.

   Modelo desconhecido custa 0 e é REGISTRADO mesmo assim: perder a linha
   inteira porque o preço não é conhecido seria trocar um número impreciso por
   nenhum número.
   ========================================================================== */
const PRECO_POR_MILHAO: Record<string, { entrada: number; saida: number }> = {
  'gpt-5.1': { entrada: 1.25, saida: 10.0 },
  'gpt-5': { entrada: 1.25, saida: 10.0 },
  'gpt-5-mini': { entrada: 0.25, saida: 2.0 },
  'gpt-5-nano': { entrada: 0.05, saida: 0.4 },
  'gpt-4.1': { entrada: 2.0, saida: 8.0 },
  'gpt-4.1-mini': { entrada: 0.4, saida: 1.6 },
  'gpt-4.1-nano': { entrada: 0.1, saida: 0.4 },
  'gpt-4o': { entrada: 2.5, saida: 10.0 },
  'gpt-4o-mini': { entrada: 0.15, saida: 0.6 },
  'o4-mini': { entrada: 1.1, saida: 4.4 },
  'o3-mini': { entrada: 1.1, saida: 4.4 },
  'text-embedding-3-small': { entrada: 0.02, saida: 0 },
}

/** Whisper cobra por minuto de áudio, não por token. */
const PRECO_WHISPER_POR_MINUTO = 0.006

export function calcularCusto(params: {
  modelo: string
  tokensEntrada?: number
  tokensSaida?: number
  segundosAudio?: number
}): number {
  if (params.segundosAudio) {
    return (params.segundosAudio / 60) * PRECO_WHISPER_POR_MINUTO
  }

  const preco = PRECO_POR_MILHAO[params.modelo]
  if (!preco) return 0

  const entrada = ((params.tokensEntrada ?? 0) / 1_000_000) * preco.entrada
  const saida = ((params.tokensSaida ?? 0) / 1_000_000) * preco.saida
  return entrada + saida
}

/**
 * O que aconteceu dentro da chamada — o "por que custou isso".
 *
 * Capturado no ponto da chamada, e não montado depois por join: só o caminho
 * de agente gera `message_traces`, e o gasto se espalha por 13 pontos. Casar
 * por proximidade de tempo atribuiria custo de uma conversa a outra.
 */
export interface DetalheUso {
  /** Uma linha, em português, do que a chamada fez. */
  resumo?: string
  /** O que entrou: tamanho do histórico, do prompt, quantos itens. */
  entradas?: { rotulo: string; valor: string }[]
  /** Ferramentas acionadas nesta chamada. */
  tools?: { nome: string; ms?: number }[]
}

export interface RegistroUso {
  operacao: OperacaoLLM
  modelo: string
  tokensEntrada?: number
  tokensSaida?: number
  /** Só quando a API não separa entrada de saída. */
  tokensTotal?: number
  segundosAudio?: number
  duracaoMs?: number
  agente?: string | null
  canal?: string | null
  contactId?: string | null
  conversationId?: string | null
  profileId?: string | null
  sucesso?: boolean
  erro?: string | null
  detalhe?: DetalheUso
}

/**
 * Grava uma linha de uso.
 *
 * É `await`, e não fogo-e-esquece: no Vercel o runtime congela quando a resposta
 * sai e a promessa solta nunca terminaria — o gasto sumiria justamente nas
 * chamadas feitas no fim de uma requisição. O custo é um insert de ~50ms numa
 * operação que já levou segundos.
 */
export async function registrarUso(uso: RegistroUso): Promise<void> {
  try {
    const entrada = uso.tokensEntrada ?? 0
    const saida = uso.tokensSaida ?? 0
    const total = uso.tokensTotal ?? entrada + saida

    const custo = calcularCusto({
      modelo: uso.modelo,
      /* Quando só há o total (a API devolveu `total_tokens` sem separar),
         cobra tudo como entrada. Subestima, porque saída é mais cara — e
         subestimar é melhor do que inventar uma divisão que não aconteceu. */
      tokensEntrada: uso.tokensEntrada ?? (uso.tokensSaida ? 0 : total),
      tokensSaida: saida,
      segundosAudio: uso.segundosAudio,
    })

    await createAdminClient()
      .from('llm_usage')
      .insert({
        operacao: uso.operacao,
        modelo: uso.modelo,
        tokens_entrada: entrada,
        tokens_saida: saida,
        tokens_total: total,
        segundos_audio: uso.segundosAudio ?? null,
        custo_usd: Number(custo.toFixed(6)),
        duracao_ms: uso.duracaoMs ?? null,
        agente: uso.agente ?? null,
        canal: uso.canal ?? null,
        contact_id: uso.contactId ?? null,
        conversation_id: uso.conversationId ?? null,
        detalhe: uso.detalhe ?? null,
        profile_id: uso.profileId ?? null,
        sucesso: uso.sucesso ?? true,
        erro: uso.erro ?? null,
      })
  } catch (e) {
    /* Engolir é deliberado: uma falha ao contabilizar não vale uma conversa
       perdida. O log é o que denuncia se isso virar rotina. */
    console.error('[uso] falha ao registrar:', (e as Error).message)
  }
}
