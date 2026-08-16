// ==========================================
// Extração de texto dos materiais institucionais.
//
// ESTE MÓDULO NÃO FOI COPIADO DA ORIGEM, de propósito.
//
// Uma extração ingênua lê o binário do PDF e remove os caracteres
// não imprimíveis. Isso "funciona" para PDF sem compressão, que é raro — no
// caso normal, o conteúdo está em streams comprimidos com Flate e o resultado é
// ruído binário. O próprio comentário lá diz "In production, replace with
// pdf-parse or unpdf".
//
// Copiar aquilo aqui seria pior do que não ter a funcionalidade: o material
// entraria com status 'indexado', o painel mostraria tudo certo, e o agente
// Suporte passaria a citar lixo como se fosse política da imobiliária. Falha
// que se parece com sucesso é a mais cara de descobrir.
//
// Então: `unpdf` (pdf.js empacotado para serverless, sem dependência nativa)
// para PDF, decodificação direta para txt/md, e RECUSA EXPLÍCITA para o resto.
// ==========================================

export const TIPOS_ACEITOS = ['pdf', 'txt', 'md', 'markdown'] as const

/** Menos que isto num arquivo inteiro é sinal de extração fracassada. */
const MINIMO_CARACTERES = 50

export type ResultadoExtracao =
  | { ok: true; texto: string; paginas?: number }
  | { ok: false; erro: string }

export function tipoDoArquivo(nome: string): string {
  return nome.toLowerCase().split('.').pop() ?? ''
}

export async function extrairTexto(
  buffer: Buffer,
  nomeArquivo: string
): Promise<ResultadoExtracao> {
  const tipo = tipoDoArquivo(nomeArquivo)

  if (tipo === 'txt' || tipo === 'md' || tipo === 'markdown') {
    const texto = new TextDecoder('utf-8').decode(buffer).trim()
    if (texto.length < MINIMO_CARACTERES) {
      return { ok: false, erro: 'O arquivo está vazio ou tem texto de menos para indexar.' }
    }
    return { ok: true, texto }
  }

  if (tipo === 'pdf') return extrairPdf(buffer)

  return {
    ok: false,
    erro: `Formato .${tipo} não é aceito. Envie PDF, TXT ou Markdown — converta DOC/DOCX para PDF antes.`,
  }
}

async function extrairPdf(buffer: Buffer): Promise<ResultadoExtracao> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const { text, totalPages } = await extractText(pdf, { mergePages: true })

    const limpo = String(text)
      .replace(/\r\n/g, '\n')
      // Ligaduras que o pdf.js devolve como caractere único e que atrapalham a busca.
      .replace(/ﬁ/g, 'fi')
      .replace(/ﬂ/g, 'fl')
      // Hifenização de fim de linha: "financia-\nmento" volta a ser uma palavra.
      .replace(/(\w)-\n(\w)/g, '$1$2')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    if (limpo.length < MINIMO_CARACTERES) {
      /* PDF que é imagem escaneada extrai quase nada. Dizer isso é melhor do
         que indexar três palavras e deixar o material parecer disponível. */
      return {
        ok: false,
        erro:
          'Não consegui extrair texto deste PDF. Se ele for um documento escaneado (imagem), ' +
          'passe por OCR antes ou envie a versão em texto.',
      }
    }

    return { ok: true, texto: limpo, paginas: totalPages }
  } catch (e) {
    console.error('[rag/extrair] PDF falhou:', (e as Error).message)
    return { ok: false, erro: 'Não foi possível ler este PDF. O arquivo pode estar corrompido.' }
  }
}
