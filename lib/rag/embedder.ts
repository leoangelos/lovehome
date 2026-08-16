// ==========================================
// RAG Embedder (PRD 11.1).
//
// Mesmo modelo e mesma dimensão dos embeddings de imóvel
// (lib/imoveis/embeddings.ts). Não é coincidência nem precisa ser: são espaços
// vetoriais separados, em tabelas separadas, e nunca comparados entre si. Mas
// manter o mesmo modelo evita a pegadinha de alguém, um dia, comparar um chunk
// com um imóvel e receber uma resposta plausível e sem sentido.
// ==========================================

import { openai } from '@/lib/openai/client'
import { registrarUso } from '@/lib/observabilidade/uso'

const MODELO = 'text-embedding-3-small'
/** Teto da OpenAI por requisição. */
const LOTE_MAXIMO = 100

export async function gerarEmbedding(texto: string): Promise<number[]> {
  const r = await openai.embeddings.create({
    model: MODELO,
    input: texto.replace(/\n/g, ' ').trim(),
  })
  await registrarUso({
    operacao: 'embedding_rag',
    modelo: MODELO,
    tokensEntrada: r.usage?.prompt_tokens,
    detalhe: {
      resumo: 'Vetorizou um trecho de material institucional',
      entradas: [{ rotulo: 'Texto', valor: `${texto.length} caracteres` }],
    },
  })

  return r.data[0].embedding
}

/** Embeddings em lote — um documento vira dezenas de chunks de uma vez. */
export async function gerarEmbeddings(textos: string[]): Promise<number[][]> {
  const saida: number[][] = []

  for (let i = 0; i < textos.length; i += LOTE_MAXIMO) {
    const lote = textos.slice(i, i + LOTE_MAXIMO).map((t) => t.replace(/\n/g, ' ').trim())
    const r = await openai.embeddings.create({ model: MODELO, input: lote })
    await registrarUso({
      operacao: 'embedding_rag',
      modelo: MODELO,
      tokensEntrada: r.usage?.prompt_tokens,
      detalhe: {
        resumo: 'Vetorizou um lote de trechos de material',
        entradas: [
          { rotulo: 'Trechos no lote', valor: String(lote.length) },
          {
            rotulo: 'Texto somado',
            valor: `${lote.reduce((t, x) => t + x.length, 0)} caracteres`,
          },
        ],
      },
    })

    saida.push(...r.data.map((d) => d.embedding))
  }

  return saida
}
