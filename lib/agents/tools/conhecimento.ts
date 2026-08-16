// ==========================================
// Tool de consulta ao conhecimento institucional (PRD 11.1).
//
// O que está aqui: condições de financiamento, documentação necessária,
// glossário (ITBI, escritura, caução, aviso prévio) e políticas da imobiliária.
//
// O que NÃO está: imóvel. Buscar imóvel é `search_properties`, com filtro
// estruturado. Se o modelo confundir os dois, o cliente recebe um trecho de
// política no lugar de um apartamento — por isso a descrição da tool é
// explícita sobre a fronteira.
// ==========================================

import { buscarNoConhecimento, CATEGORIAS, type CategoriaMaterial } from '@/lib/rag/retriever'
import type OpenAI from 'openai'

type Tool = OpenAI.ChatCompletionTool

export const searchKnowledgeBaseTool: Tool = {
  type: 'function',
  function: {
    name: 'search_knowledge_base',
    description: `Consulta o material da imobiliária para responder dúvida de PROCESSO:
financiamento, documentos necessários, significado de um termo (ITBI, escritura, caução,
aviso prévio), prazos e políticas da casa.

NÃO use para buscar imóvel — para isso existe search_properties.
Use SEMPRE que a pessoa perguntar "como funciona", "o que preciso", "o que significa":
responder de memória sobre regra de negócio é como o sistema inventa informação.`,
    parameters: {
      type: 'object',
      properties: {
        pergunta: {
          type: 'string',
          description: 'A dúvida, nas palavras da pessoa. Não resuma nem reformule.',
        },
        categoria: {
          type: 'string',
          enum: CATEGORIAS,
          description: 'Restrinja o assunto quando estiver claro. Omita em caso de dúvida.',
        },
      },
      required: ['pergunta'],
    },
  },
}

export async function handleSearchKnowledgeBase(params: {
  pergunta: string
  categoria?: CategoriaMaterial
}) {
  const trechos = await buscarNoConhecimento({
    consulta: params.pergunta,
    categoria: params.categoria ?? null,
  })

  if (!trechos.length) {
    /* Nada encontrado é uma resposta legítima e precisa ser dita como tal. A
       instrução aqui é o que impede o modelo de preencher o vazio com uma regra
       plausível — que, em financiamento e documentação, vira informação errada
       na mão de alguém tomando decisão de dezenas de milhares de reais. */
    return {
      encontrado: false,
      instrucao:
        'O material da imobiliária não cobre isso. NÃO responda de memória e NÃO invente ' +
        'regra, prazo ou percentual. Diga que vai confirmar com um corretor e siga a conversa.',
    }
  }

  return {
    encontrado: true,
    trechos: trechos.map((t) => ({
      documento: t.documento,
      categoria: t.categoria,
      conteudo: t.content,
    })),
    instrucao:
      'Responda com base NOS TRECHOS acima, em frase corrida e curta. Não cite o nome do ' +
      'documento nem diga "segundo o material" — a pessoa está conversando com a imobiliária, ' +
      'não consultando um arquivo. Se os trechos não responderem à pergunta, diga que confirma ' +
      'com um corretor em vez de completar com o que você acha.',
  }
}
